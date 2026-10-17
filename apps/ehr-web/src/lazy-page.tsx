import { lazy, Suspense, type ComponentType } from 'react';
import PageLoadFailed from './components/PageLoadFailed';

const RELOAD_KEY = 'ehr-chunk-reload';

/**
 * Loads a page only when its route is first opened (roadmap 28.5), so the
 * first screen does not download every module.
 *
 * After a new release the old chunk files are gone; a tab opened before the
 * upgrade then fails to load a page. Reload once to pick up the new build.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(() =>
    load().then(
      (module) => {
        sessionStorage.removeItem(RELOAD_KEY);
        return module;
      },
      () => {
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<never>(() => {});
        }
        // Still failing after a reload (e.g. the network is down): say so
        // instead of leaving the whole app blank.
        sessionStorage.removeItem(RELOAD_KEY);
        return { default: PageLoadFailed };
      },
    ),
  );
  return function LazyPage() {
    return (
      <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>
        <Page />
      </Suspense>
    );
  };
}
