/** Shown when a page's code cannot be downloaded even after a reload. */
export default function PageLoadFailed() {
  return (
    <div className="route-loading" role="alert">
      This page could not be loaded. Check the network connection, then{' '}
      <button type="button" onClick={() => window.location.reload()}>
        reload
      </button>
      .
    </div>
  );
}
