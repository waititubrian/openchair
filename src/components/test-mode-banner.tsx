export function TestModeBanner() {
  return (
    <div
      role="status"
      className="bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      TEST MODE: no real payments are processed. Use card 4242 4242 4242 4242.
    </div>
  );
}
