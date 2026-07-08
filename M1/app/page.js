export const dynamic = 'force-static';

export default function Page() {
  return (
    <iframe
      src="/galaga8.html"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
      }}
    />
  );
}
