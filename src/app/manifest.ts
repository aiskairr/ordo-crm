import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ordo CRM",
    short_name: "Ordo CRM",
    description: "CRM для продаж, сотрудников и операционных процессов",
    start_url: "/sales",
    scope: "/",
    display: "standalone",
    background_color: "#eef3ff",
    theme_color: "#15182b",
    orientation: "any",
    icons: [
      {
        src: "/ordo-logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
