"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const revealSelector = [
  ".hero-copy",
  ".hero-meta",
  ".control-row",
  ".performance-panel",
  ".stats-panel > article",
  ".section-title",
  ".position-card",
  ".heatmap-group",
  ".focus-workspace",
  ".table-controls",
  ".table-wrap",
  ".auth-story > *",
  ".auth-panel > *",
  "footer > *",
].join(",");

export default function MotionController() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("motion-ready");

    if (reduced) {
      document.querySelectorAll(revealSelector).forEach((element) => element.dataset.motionState = "visible");
      return undefined;
    }

    let order = 0;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.dataset.motionState = "visible";
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -7%", threshold: 0.08 });

    const register = (scope = document) => {
      scope.querySelectorAll?.(revealSelector).forEach((element) => {
        if (element.dataset.motionState) return;
        element.dataset.motionState = "pending";
        element.style.setProperty("--motion-order", order % 8);
        order += 1;
        observer.observe(element);
      });
    };

    const mutations = new MutationObserver((entries) => {
      entries.forEach((entry) => entry.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.(revealSelector)) register(node.parentElement || document);
        else register(node);
      }));
    });

    const trackPointer = (event) => {
      const target = event.target.closest?.("button, a, .position-card, tbody tr, .heatmap-group");
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      target.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
      target.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
    };

    register();
    mutations.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointermove", trackPointer, { passive: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      document.removeEventListener("pointermove", trackPointer);
    };
  }, []);

  useEffect(() => {
    document.body.classList.remove("route-arrived");
    const frame = requestAnimationFrame(() => document.body.classList.add("route-arrived"));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
