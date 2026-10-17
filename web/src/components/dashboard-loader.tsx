"use client";

import dynamic from "next/dynamic";

// the dashboard reads the clock and saved inputs on first render, so it renders on the client only
export const DashboardLoader = dynamic(() => import("./dashboard").then((m) => m.Dashboard), {
  ssr: false,
  loading: () => (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="text-lg font-semibold tracking-[-0.01em] text-ink">HazeWise</span>
        <span className="text-sm text-ink-2">Run risk planner</span>
      </div>
    </div>
  ),
});
