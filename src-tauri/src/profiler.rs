use crate::error::AppResult;
use crate::rocm::which;
use std::process::Command;

// ---------- Serialized shapes (snake_case, matched verbatim by the frontend) ----------

#[derive(serde::Serialize)]
pub struct ProfilerStatus {
    pub available: bool,
    pub tool: String, // "rocprof" | "rocprofv3" | ""
}

#[derive(serde::Serialize, Clone)]
pub struct KernelStat {
    pub name: String,
    pub calls: u64,
    pub total_ns: u64,
    pub avg_ns: u64,
    pub pct: f64,
}

#[derive(serde::Serialize, Clone)]
pub struct TraceSpan {
    pub name: String,
    pub start_ns: u64,
    pub dur_ns: u64,
    pub lane: u32,
}

#[derive(serde::Serialize)]
pub struct ProfileResult {
    pub tool: String,
    pub target: String,
    pub total_ns: u64,
    pub kernels: Vec<KernelStat>,
    pub trace: Vec<TraceSpan>,
    pub lanes: u32,
    pub raw_path: String,
    pub notes: String,
}

// ---------- Commands ----------

#[tauri::command]
pub fn profiler_available() -> ProfilerStatus {
    // Prefer classic rocprof; fall back to rocprofv3 if that's all that's present.
    for tool in ["rocprof", "rocprofv3"] {
        if which(tool).is_some() {
            return ProfilerStatus { available: true, tool: tool.into() };
        }
    }
    ProfilerStatus { available: false, tool: String::new() }
}

#[tauri::command]
pub fn profiler_run(target: String, args: Vec<String>) -> AppResult<ProfileResult> {
    let status = profiler_available();
    if !status.available {
        return Err("rocprof not found — install ROCm profiler tools".into());
    }
    let tool = status.tool;

    // Isolated temp dir per run so concurrent/repeat runs don't clobber each other.
    let tmp = std::env::temp_dir().join(format!(
        "rocm-forge-prof-{}",
        chrono::Utc::now().timestamp_millis()
    ));
    std::fs::create_dir_all(&tmp)?;
    let out_csv = tmp.join("results.csv");

    // SECURITY: target/args are passed as discrete argv entries after `--`.
    // Nothing is ever concatenated into a shell string.
    let run = Command::new(&tool)
        .arg("--stats")
        .arg("-o")
        .arg(&out_csv)
        .arg("--")
        .arg(&target)
        .args(&args)
        .current_dir(&tmp)
        .output();

    let mut notes = String::new();
    match &run {
        Ok(o) => {
            if !o.status.success() {
                notes.push_str(&format!("rocprof exited with {}. ", o.status));
                let err = String::from_utf8_lossy(&o.stderr);
                let err = err.trim();
                if !err.is_empty() {
                    notes.push_str(&format!("stderr: {} ", err.lines().last().unwrap_or("")));
                }
            }
        }
        Err(e) => {
            // Couldn't even launch the profiler — degrade to an explanatory result.
            return Err(format!("failed to launch {tool}: {e}").into());
        }
    }

    // rocprof writes `<base>.stats.csv` next to the `-o` file, plus the trace csv itself.
    let stats_csv = find_file(&tmp, ".stats.csv", None)
        .unwrap_or_else(|| tmp.join("results.stats.csv"));
    let kernels = match std::fs::read_to_string(&stats_csv) {
        Ok(s) => parse_stats(&s),
        Err(_) => Vec::new(),
    };

    // Per-dispatch trace: the plain results.csv (or any non-stats csv rocprof left behind).
    let trace_csv = if out_csv.exists() {
        Some(out_csv.clone())
    } else {
        find_file(&tmp, ".csv", Some(".stats.csv"))
    };
    let mut raw_spans = match trace_csv.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(s) => parse_trace(&s),
        None => Vec::new(),
    };

    // Never show an empty timeline: fall back to a sequential view built from the
    // per-kernel stats (each kernel one span, sized by its total duration).
    if raw_spans.is_empty() {
        if !notes.is_empty() {
            notes.push_str("· ");
        }
        notes.push_str("no per-dispatch trace — timeline derived from kernel stats. ");
        let mut cursor = 0u64;
        for k in &kernels {
            raw_spans.push(TraceSpan {
                name: k.name.clone(),
                start_ns: cursor,
                dur_ns: k.total_ns,
                lane: 0,
            });
            cursor = cursor.saturating_add(k.total_ns);
        }
    } else {
        notes.push_str(&format!("parsed {} dispatch spans. ", raw_spans.len()));
    }

    let (trace, lanes) = build_trace(raw_spans);

    // Prefer the summed kernel time; if stats were missing, use the trace coverage.
    let mut total_ns: u64 = kernels.iter().map(|k| k.total_ns).sum();
    if total_ns == 0 {
        total_ns = trace.iter().map(|s| s.start_ns + s.dur_ns).max().unwrap_or(0);
    }

    if kernels.is_empty() && trace.is_empty() {
        notes.push_str("no kernels captured — the target may not have launched any GPU kernels.");
    }

    Ok(ProfileResult {
        tool,
        target,
        total_ns,
        kernels,
        trace,
        lanes,
        raw_path: tmp.to_string_lossy().to_string(),
        notes: notes.trim().to_string(),
    })
}

// ---------- Standalone, testable parsing / packing ----------

/// Split one CSV line, honoring `"`-quoted fields (kernel names contain commas,
/// e.g. `void kernel<int, float>(...)`) and `""` escaped quotes.
fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                fields.push(cur.trim().to_string());
                cur.clear();
            }
            _ => cur.push(c),
        }
    }
    fields.push(cur.trim().to_string());
    fields
}

fn parse_u64(s: &str) -> u64 {
    // Tolerate stray characters / decimals in numeric columns.
    let cleaned: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    cleaned.parse().unwrap_or(0)
}

fn parse_f64(s: &str) -> f64 {
    s.trim().trim_end_matches('%').trim().parse().unwrap_or(0.0)
}

/// Locate a column index by header keyword(s) (case-insensitive substring).
fn col(headers: &[String], needles: &[&str]) -> Option<usize> {
    headers.iter().position(|h| {
        let h = h.to_lowercase();
        needles.iter().all(|n| h.contains(n))
    })
}

/// Parse a rocprof `.stats.csv`. Header-driven so extra/reordered columns are fine.
/// Typical header: "Name","Calls","TotalDurationNs","AverageNs","Percentage".
pub fn parse_stats(csv: &str) -> Vec<KernelStat> {
    let mut lines = csv.lines().filter(|l| !l.trim().is_empty());
    let header = match lines.next() {
        Some(h) => split_csv_line(h),
        None => return Vec::new(),
    };
    let name_i = col(&header, &["name"]);
    let calls_i = col(&header, &["calls"]);
    let total_i = col(&header, &["total"]).or_else(|| col(&header, &["durationns"]));
    let avg_i = col(&header, &["average"]).or_else(|| col(&header, &["avg"]));
    let pct_i = col(&header, &["percent"]).or_else(|| col(&header, &["%"]));

    let get = |row: &[String], i: Option<usize>| -> String {
        i.and_then(|i| row.get(i)).cloned().unwrap_or_default()
    };

    let mut out = Vec::new();
    for line in lines {
        let row = split_csv_line(line);
        let name = get(&row, name_i);
        if name.is_empty() {
            continue;
        }
        out.push(KernelStat {
            name,
            calls: parse_u64(&get(&row, calls_i)),
            total_ns: parse_u64(&get(&row, total_i)),
            avg_ns: parse_u64(&get(&row, avg_i)),
            pct: parse_f64(&get(&row, pct_i)),
        });
    }
    out
}

/// Parse a rocprof per-dispatch trace csv into spans (unnormalized, lane=0).
/// Header-driven: needs a kernel-name column and Begin/End nanosecond columns.
pub fn parse_trace(csv: &str) -> Vec<TraceSpan> {
    let mut lines = csv.lines().filter(|l| !l.trim().is_empty());
    let header = match lines.next() {
        Some(h) => split_csv_line(h),
        None => return Vec::new(),
    };
    let name_i = col(&header, &["kernel", "name"])
        .or_else(|| col(&header, &["name"]));
    let begin_i = col(&header, &["begin"]).or_else(|| col(&header, &["start"]));
    let end_i = col(&header, &["end"]);
    let (name_i, begin_i, end_i) = match (name_i, begin_i, end_i) {
        (Some(n), Some(b), Some(e)) => (n, b, e),
        _ => return Vec::new(),
    };

    let mut out = Vec::new();
    for line in lines {
        let row = split_csv_line(line);
        let name = row.get(name_i).cloned().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let begin = parse_u64(row.get(begin_i).map(String::as_str).unwrap_or(""));
        let end = parse_u64(row.get(end_i).map(String::as_str).unwrap_or(""));
        if end < begin {
            continue;
        }
        out.push(TraceSpan { name, start_ns: begin, dur_ns: end - begin, lane: 0 });
    }
    out
}

/// Normalize spans so the earliest starts at 0, then greedily pack them into lanes.
fn build_trace(spans: Vec<TraceSpan>) -> (Vec<TraceSpan>, u32) {
    if spans.is_empty() {
        return (spans, 0);
    }
    let mut spans = spans;
    spans.sort_by_key(|s| s.start_ns);
    let base = spans[0].start_ns;
    for s in &mut spans {
        s.start_ns -= base;
    }
    let lanes = pack_lanes(&mut spans);
    (spans, lanes)
}

/// Greedy overlap packing: each span goes in the first lane whose previous span
/// ended at or before this one's start. Returns the number of lanes used.
/// Sorts the slice by start first, so callers needn't pre-sort.
pub fn pack_lanes(spans: &mut [TraceSpan]) -> u32 {
    spans.sort_by_key(|s| s.start_ns);
    let mut lane_ends: Vec<u64> = Vec::new();
    for s in spans.iter_mut() {
        let slot = lane_ends.iter().position(|&end| end <= s.start_ns);
        let lane = match slot {
            Some(i) => i,
            None => {
                lane_ends.push(0);
                lane_ends.len() - 1
            }
        };
        s.lane = lane as u32;
        lane_ends[lane] = s.start_ns + s.dur_ns;
    }
    lane_ends.len() as u32
}

/// First file in `dir` whose name ends with `suffix` (and not `exclude`).
fn find_file(dir: &std::path::Path, suffix: &str, exclude: Option<&str>) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(suffix) && exclude.map(|x| !name.ends_with(x)).unwrap_or(true) {
            return Some(e.path());
        }
    }
    None
}

// ---------- Tests (no rocprof / hardware required) ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stats_csv_with_quoted_names() {
        // Note the comma *inside* the quoted kernel name — must not split the row.
        let csv = "\"Name\",\"Calls\",\"TotalDurationNs\",\"AverageNs\",\"Percentage\"\n\
                   \"void gemm<float, 128>(float*)\",10,5000,500,62.5\n\
                   \"reduce_kernel\",4,3000,750,37.5\n";
        let stats = parse_stats(csv);
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].name, "void gemm<float, 128>(float*)");
        assert_eq!(stats[0].calls, 10);
        assert_eq!(stats[0].total_ns, 5000);
        assert_eq!(stats[0].avg_ns, 500);
        assert!((stats[0].pct - 62.5).abs() < 1e-9);
        assert_eq!(stats[1].name, "reduce_kernel");
        assert_eq!(stats[1].calls, 4);
    }

    #[test]
    fn parses_stats_with_reordered_extra_columns() {
        let csv = "Index,Calls,Name,Percentage,TotalDurationNs,AverageNs\n\
                   0,3,my_kernel,100.0,9000,3000\n";
        let stats = parse_stats(csv);
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].name, "my_kernel");
        assert_eq!(stats[0].calls, 3);
        assert_eq!(stats[0].total_ns, 9000);
        assert_eq!(stats[0].avg_ns, 3000);
        assert!((stats[0].pct - 100.0).abs() < 1e-9);
    }

    #[test]
    fn parses_trace_and_computes_duration() {
        let csv = "KernelName,BeginNs,EndNs\nk0,1000,1500\nk1,1200,1800\n";
        let spans = parse_trace(csv);
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].start_ns, 1000);
        assert_eq!(spans[0].dur_ns, 500);
        assert_eq!(spans[1].dur_ns, 600);
    }

    #[test]
    fn pack_lanes_stacks_overlapping_spans() {
        // A [0,10) and B [5,15) overlap -> different lanes.
        // C [20,30) starts after A ends -> reuses lane 0.
        let mut spans = vec![
            TraceSpan { name: "A".into(), start_ns: 0, dur_ns: 10, lane: 0 },
            TraceSpan { name: "B".into(), start_ns: 5, dur_ns: 10, lane: 0 },
            TraceSpan { name: "C".into(), start_ns: 20, dur_ns: 10, lane: 0 },
        ];
        let lanes = pack_lanes(&mut spans);
        assert_eq!(lanes, 2);
        let lane_of = |n: &str| spans.iter().find(|s| s.name == n).unwrap().lane;
        assert_eq!(lane_of("A"), 0);
        assert_eq!(lane_of("B"), 1);
        assert_eq!(lane_of("C"), 0); // freed after A ended
    }

    #[test]
    fn build_trace_normalizes_start_to_zero() {
        let spans = vec![
            TraceSpan { name: "a".into(), start_ns: 5000, dur_ns: 100, lane: 0 },
            TraceSpan { name: "b".into(), start_ns: 5300, dur_ns: 100, lane: 0 },
        ];
        let (out, lanes) = build_trace(spans);
        assert_eq!(out[0].start_ns, 0);
        assert_eq!(out[1].start_ns, 300);
        assert_eq!(lanes, 1); // non-overlapping -> single lane
    }
}
