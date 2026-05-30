type Params = { deviceId: string };

export default function SettingsDevicePage({ params }: { params: Params }) {
  return (
    <div className="p-6 text-sm text-zinc-600">
      Edit device {params.deviceId} (empty form in v1 skeleton)
    </div>
  );
}
