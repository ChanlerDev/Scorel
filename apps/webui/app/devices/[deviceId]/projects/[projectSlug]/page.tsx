type Params = { deviceId: string; projectSlug: string };

export default function ProjectPage({ params }: { params: Params }) {
  return (
    <div className="p-6 text-sm text-zinc-600">
      Project {params.projectSlug} on {params.deviceId} — empty (no sessions yet)
    </div>
  );
}
