/**
 * What the site shows before the hosts have saved anything, and the shape the
 * admin config form edits. Once they save, these values live in the database
 * and this file is only a fallback.
 */

export type Localized = { en: string; es: string };

export type Registry = {
  name: string;
  url: string;
  description: Localized;
  /** One of the keys in REGISTRY_ACCENTS. */
  accent: string;
};

export type Settings = {
  babyName: string;
  honorees: string;
  venueName: string;
  address: string;
  mapsQuery: string;
  /** Local datetime, "YYYY-MM-DDTHH:mm" — the value an <input type="datetime-local"> gives. */
  startISO: string;
  endISO: string;
  /** "YYYY-MM-DD" */
  rsvpDeadlineISO: string;
  tagline: Localized;
  dressCode: Localized;
  notes: Localized;
  contactName: string;
  contactEmail: string;
  giftShippingAddress: string;
  registries: Registry[];
  mealOptions: Localized[];
  askMeal: boolean;
  allowKids: boolean;
  collectPhone: boolean;
};

/** Swatches offered for registry cards. Fixed so Tailwind can see the classes. */
export const REGISTRY_ACCENTS = ["sage", "clay", "amber", "sky"] as const;

export const DEFAULT_SETTINGS: Settings = {
  babyName: "Baby Rivera",
  honorees: "Sam & Alex",
  venueName: "The Garden Room at Willow House",
  address: "1420 Magnolia Lane, Austin, TX 78704",
  mapsQuery: "1420 Magnolia Lane, Austin, TX 78704",
  startISO: "2026-10-18T14:00",
  endISO: "2026-10-18T17:00",
  rsvpDeadlineISO: "2026-10-01",
  tagline: {
    en: "A little one is on the way",
    es: "Viene un pequeñito en camino",
  },
  dressCode: {
    en: "Garden party casual — soft colors encouraged",
    es: "Informal de jardín — se agradecen los colores suaves",
  },
  notes: {
    en: "Brunch bites, a build-your-own mocktail bar, and far too many tiny socks. Come hungry.",
    es: "Bocadillos de brunch, una barra de cócteles sin alcohol y demasiados calcetincitos. Vengan con hambre.",
  },
  contactName: "Sam",
  contactEmail: "hello@example.com",
  giftShippingAddress: "Sam & Alex Rivera, 88 Cypress Street, Austin, TX 78704",
  registries: [
    {
      name: "Amazon",
      url: "https://www.amazon.com/baby-reg/",
      description: {
        en: "The everyday stuff — bottles, burp cloths, the unglamorous heroes.",
        es: "Lo de todos los días: biberones, baberos y los héroes menos glamorosos.",
      },
      accent: "amber",
    },
    {
      name: "Target",
      url: "https://www.target.com/gift-registry/",
      description: {
        en: "Nursery, clothes, and the big-ticket items.",
        es: "La habitación del bebé, ropa y las cosas grandes.",
      },
      accent: "clay",
    },
    {
      name: "Babylist",
      url: "https://www.babylist.com/",
      description: {
        en: "A little of everything, plus a cash fund for the car seat.",
        es: "Un poco de todo, más un fondo para la sillita del coche.",
      },
      accent: "sage",
    },
  ],
  mealOptions: [
    { en: "No preference", es: "Sin preferencia" },
    { en: "Vegetarian", es: "Vegetariano" },
    { en: "Vegan", es: "Vegano" },
    { en: "Gluten-free", es: "Sin gluten" },
  ],
  askMeal: true,
  allowKids: true,
  collectPhone: true,
};
