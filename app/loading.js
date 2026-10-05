export default function Loading() {
  return <main className="route-loader" aria-busy="true">
    <div className="route-loader-brand"><span className="route-loader-mark" aria-hidden="true"/>Aperture</div>
    <div className="route-loader-copy" aria-hidden="true"><span/><span/><span/></div>
    <div className="route-loader-progress" aria-hidden="true"><i/></div>
    <p role="status" aria-live="polite">Bringing the market into focus</p>
  </main>;
}
