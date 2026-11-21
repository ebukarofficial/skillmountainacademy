// Programme photos and where each is anchored in its card (no "use client", so server pages can use them too).
import type { StaticImageData } from "next/image";
import pGraphics from "@/assets/photos/photo-graphics.webp";
import pDevops from "@/assets/photos/photo-devops.webp";
import pCloud from "@/assets/photos/photo-cloud.webp";
import pMarketing from "@/assets/photos/photo-marketing.webp";
import pUiux from "@/assets/photos/photo-uiux.webp";
import pCyber from "@/assets/photos/photo-cyber.webp";
import pWeb from "@/assets/photos/photo-web.webp";
import pCloudDevops from "@/assets/photos/photo-data.webp";
import pSma from "@/assets/photos/photo-sma.webp";

// One photo per programme slug.
export const PHOTO: Record<string, StaticImageData> = {
  graphics: pGraphics, uiux: pUiux, webdev: pWeb, marketing: pMarketing, cybersecurity: pCyber,
  cloud: pCloud, devops: pDevops, "cloud-devops": pCloudDevops,
  // No dedicated photograph yet: the Academy photo is used until the owner supplies one.
  "ai-automation": pSma,
};

// Where each photo is anchored inside its card, so faces are never cropped out ("x% y%").
export const FOCUS: Record<string, string> = {
  graphics: "75% 0%", uiux: "45% 0%", webdev: "50% 0%", marketing: "60% 0%", cybersecurity: "50% 0%",
  cloud: "50% 0%", devops: "35% 0%", "cloud-devops": "50% 0%", "ai-automation": "50% 20%",
};

export const SMA_PHOTO = pSma;
