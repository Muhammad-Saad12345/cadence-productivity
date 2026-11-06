import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Cadence — Tasks, Reminders & Goals",
    short_name: "Cadence",
    description: "Personal task manager with persistent reminders, weekly & monthly goals and habits.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#fafafc",
    theme_color: "#4f46e5",
    orientation: "any",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today", url: "/today" },
      { name: "Add task", url: "/today?new=1" },
      { name: "Goals", url: "/goals" },
    ],
  };
}
