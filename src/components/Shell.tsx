import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import Marquee from "./Marquee";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[240px_1fr] min-h-screen">
      <Sidebar />
      <main className="flex flex-col min-w-0">
        <TopBar />
        <div className="flex-1 min-w-0">{children}</div>
        <Marquee />
      </main>
    </div>
  );
}
