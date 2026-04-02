import { Route, Routes } from "react-router-dom";
import { About } from "./pages/About";
import { Contact } from "./pages/Contact";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />
    </Routes>
  );
}
