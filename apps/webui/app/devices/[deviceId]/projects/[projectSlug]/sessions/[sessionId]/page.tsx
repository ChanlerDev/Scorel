type Params = { deviceId: string; projectSlug: string; sessionId: string };

export default function SessionPage({ params }: { params: Params }) {
  return (
    <div className="p-6 text-sm text-zinc-600">
      Session {params.sessionId} — chatbox not implemented yet
    </div>
  );
}
