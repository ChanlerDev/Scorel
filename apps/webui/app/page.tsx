"use client";

import Link from "next/link";
import { useDevices } from "../lib/store/use-devices";

export default function HomePage() {
  const { devices } = useDevices();

  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="greeting">欢迎使用 Scorel</h1>
        <p className="text-md text-muted">先添加一个设备开始</p>
        <Link
          href="/settings"
          className="rounded-pill bg-accent px-5 py-2 text-bg hover:bg-accent-hover"
        >
          打开 Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="greeting">今天聊点什么?</h1>
      <p className="text-md text-muted">从左侧选择一个设备和会话开始</p>
    </div>
  );
}
