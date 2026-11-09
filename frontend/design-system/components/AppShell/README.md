# AppShell

The one layout every signed-in account uses: the menu on the right, content beside it; a bottom bar on phones. From `src/components/AppShell.tsx`.

- **Provide:** `subtitle` (company and role, «بیمه دانا، پزشک»), `homeTo`, `userName`, `userRole`, `nav` (`[{ to, label, icon, badge?, match? }]`), `onLogout`, optional `banner` (ViewAsBanner) and `className` (`patient` for the patient panel's larger type), and the page as `children`.
- The menu is 256px of `nav-bg` with the scanner rings in `nav-active` at its foot; the active item is `surface` with `accent` text. A `badge` count shows in `warn-bg`.
- At 1280px and up it is the full menu. From 861px to 1279px, on tablets on their side and small laptops, it narrows to a 96px rail with each icon above its label. At 860px and below the same items become a bar along the bottom and a compact header appears; on short screens, such as a phone on its side, that bar is one thin line.
- Needs `RouterProvider` above it. In the app a sample-data chip shows in sample mode; this bundle shows the connected look.
