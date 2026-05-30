type Params = { deviceId: string };

export default function DevicePage({ params }: { params: Params }) {
  return (
    <div className="p-6 text-sm text-zinc-600">
      Device {params.deviceId} — empty (no projects synced yet)
    </div>
  );
}
