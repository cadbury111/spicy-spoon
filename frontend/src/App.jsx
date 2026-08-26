import { useEffect, useState } from "react";
import {
  Utensils,
  Calendar,
  Clock,
  MapPin,
  Phone,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  ChefHat,
  Lock,
} from "lucide-react";
import CustomerMenu from "./pages/CustomerMenu";
import VisualTableBooking from "./pages/VisualTableBooking";
import RestaurantLanding from "./pages/RestaurantLanding";
import GuestSessionDashboard from "./pages/GuestSessionDashboard";
import BillPayment from "./pages/BillPayment";
import Admin from "./pages/Admin";
import Kitchen from "./pages/Kitchen";
import StaffLogin from "./pages/StaffLogin";
import "./App.css";

import restaurantFront from "./assets/restaurant-front.png";
import restaurantSide from "./assets/restaurant-side.png";

import tandooriChicken from "./assets/tandoori-chicken.jpg";
import butterChicken from "./assets/butter-chicken.jpg";
import chickenBiryani from "./assets/chicken-biryani.jpg";
import prawnFry from "./assets/prawn-fry.jpg";
import paneerTikka from "./assets/paneer-tikka.jpg";
import gulabJamun from "./assets/gulab-jamun.jpg";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  // Staff Authentication State
  const [staffToken, setStaffToken] = useState(() => localStorage.getItem("spicy_staff_token"));
  const [staffUser, setStaffUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("spicy_staff_user"));
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash);
      setCurrentPath(window.location.pathname);
      setStaffToken(localStorage.getItem("spicy_staff_token"));
      try {
        setStaffUser(JSON.parse(localStorage.getItem("spicy_staff_user")));
      } catch {
        setStaffUser(null);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  const handleStaffLoginSuccess = (user) => {
    setStaffToken(localStorage.getItem("spicy_staff_token"));
    setStaffUser(user);
    if (user.role === "ADMIN") {
      window.location.hash = "#/admin";
    } else if (user.role === "KITCHEN") {
      window.location.hash = "#/kitchen";
    } else {
      window.location.hash = "#home";
    }
  };

  const handleStaffLogout = () => {
    localStorage.removeItem("spicy_staff_token");
    localStorage.removeItem("spicy_staff_user");
    setStaffToken(null);
    setStaffUser(null);
    window.location.hash = "#home";
  };

  // ================= ROUTING & ACCESS CONTROL =================

  // 1. Staff Login Page
  if (
    currentHash.startsWith("#/staff/login") ||
    currentHash.startsWith("#/admin/login") ||
    currentHash.startsWith("#/kitchen/login")
  ) {
    const defaultRole = currentHash.includes("kitchen") ? "KITCHEN" : "ADMIN";
    return <StaffLogin defaultRole={defaultRole} onLoginSuccess={handleStaffLoginSuccess} />;
  }

  // 2. Admin Portal (Protected: ADMIN ONLY)
  if (currentHash.startsWith("#/admin") || currentPath.startsWith("/admin")) {
    if (!staffToken || !staffUser) {
      return <StaffLogin defaultRole="ADMIN" onLoginSuccess={handleStaffLoginSuccess} />;
    }
    if (staffUser.role !== "ADMIN") {
      return (
        <div className="access-denied-page">
          <div className="denied-box">
            <Lock size={48} className="denied-icon" />
            <h2>403 Forbidden - Admin Privilege Required</h2>
            <p>Your current account ({staffUser.username}) is logged in as {staffUser.role}.</p>
            <div className="denied-actions">
              <a href="#/kitchen" className="btn-denied-primary">Go to Kitchen KDS →</a>
              <button onClick={handleStaffLogout} className="btn-denied-logout">Logout</button>
            </div>
          </div>
        </div>
      );
    }
    return <Admin onLogout={handleStaffLogout} />;
  }

  // 3. Kitchen KDS (Protected: KITCHEN or ADMIN)
  if (currentHash.startsWith("#/kitchen") || currentPath.startsWith("/kitchen")) {
    if (!staffToken || !staffUser) {
      return <StaffLogin defaultRole="KITCHEN" onLoginSuccess={handleStaffLoginSuccess} />;
    }
    return <Kitchen onLogout={handleStaffLogout} />;
  }

  // 4. Guest Session Dashboard (Public Guest: NO LOGIN)
  if (currentHash.startsWith("#/session") || currentPath.startsWith("/session")) {
    return <GuestSessionDashboard />;
  }

  // 5. Visual Table Booking (Public Guest: NO LOGIN)
  if (
    currentHash.includes("/tables") ||
    currentHash.startsWith("#/booking") ||
    currentPath.includes("/tables")
  ) {
    return <VisualTableBooking slug="spicy-spoon" />;
  }

  // 6. Direct Table QR Entry (Public Guest: NO LOGIN)
  if (currentHash.includes("/table/")) {
    const match = currentHash.match(/\/table\/([A-Za-z0-9]+)/i);
    const tableParam = match ? match[1] : "T1";
    return <RestaurantLanding slug="spicy-spoon" tableParam={tableParam} />;
  }

  // 7. Restaurant Portal (Public Guest: NO LOGIN)
  if (
    (currentHash.startsWith("#/restaurant/") && !currentHash.includes("/order")) ||
    (currentPath.startsWith("/restaurant/") && !currentPath.includes("/order"))
  ) {
    const slugMatch = (currentHash || currentPath).match(/\/restaurant\/([A-Za-z0-9-_]+)/);
    const slug = slugMatch ? slugMatch[1] : "spicy-spoon";
    return <RestaurantLanding slug={slug} />;
  }

  // 8. Live Bill & Payment (Public Guest: NO LOGIN)
  if (currentHash.startsWith("#/bill") || currentPath.startsWith("/bill")) {
    const billMatch = currentHash.match(/#\/bill\/([A-Za-z0-9-_]+)/i);
    const billId = billMatch ? billMatch[1] : "live";
    return <BillPayment billId={billId} />;
  }

  // 9. Customer Menu & Ordering (Public Guest: NO LOGIN)
  if (currentHash.startsWith("#/order") || currentHash.includes("/order") || currentPath.includes("/order")) {
    return <CustomerMenu />;
  }

  // ================= NAVIGATION HELPERS =================
  const goToOrder = (table = "T1") => {
    window.location.hash = `#/order?table=${table}`;
  };

  const goToTables = () => {
    window.location.hash = "#/restaurant/spicy-spoon/tables";
  };

  return (
    <main className="landing-page-container">
      {/* ================= NAVBAR ================= */}
      <nav className="navbar">
        <div className="nav-logo">
          SPICY <span>SPOON</span>
        </div>

        {/* Desktop Navigation */}
        <div className="nav-links">
          <a href="#home">HOME</a>
          <a href="#story">OUR STORY</a>
          <a href="#menu">SPECIALITIES</a>
          <a href="#contact">CONTACT</a>
        </div>

        {/* Desktop Actions */}
        <div className="nav-actions-group">
          <button className="nav-order" onClick={() => goToOrder("T1")}>
            ORDER NOW
          </button>
        </div>

        {/* Mobile Hamburger */}
        <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          <span></span>
          <span></span>
          <span></span>
        </button>

        {/* Mobile Menu */}
        <div className={`mobile-menu ${menuOpen ? "active" : ""}`}>
          <a href="#home" onClick={() => setMenuOpen(false)}>
            HOME
          </a>
          <a href="#story" onClick={() => setMenuOpen(false)}>
            OUR STORY
          </a>
          <a href="#menu" onClick={() => setMenuOpen(false)}>
            SPECIALITIES
          </a>
          <a href="#contact" onClick={() => setMenuOpen(false)}>
            CONTACT
          </a>
          <button className="mobile-order" onClick={() => { setMenuOpen(false); goToOrder("T1"); }}>
            ORDER NOW
          </button>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <section id="home" className="hero" style={{ backgroundImage: `url(${restaurantFront})` }}>
        <div className="hero-overlay"></div>

        <div className="hero-content">
          <div className="hero-badge">
            <Sparkles size={14} />
            <span>FINE INDIAN DINING & CLAY OVEN CRAFT</span>
          </div>

          <h1>
            SPICY <span>SPOON</span>
          </h1>

          <p className="hero-description">Authentic Flavours. Smoked Tandoori. Warm Hospitality.</p>

          <div className="hero-buttons-row">
            <button className="hero-button" onClick={goToTables}>
              <Calendar size={18} />
              <span>BOOK A TABLE</span>
            </button>
            <button className="hero-secondary-button" onClick={() => goToOrder("T1")}>
              EXPLORE DIGITAL MENU →
            </button>
          </div>
        </div>
      </section>

      {/* ================= OUR STORY ================= */}
      <section id="story" className="our-story">
        <div className="story-container">
          <div className="story-image">
            <img src={restaurantSide} alt="Spicy Spoon Restaurant" />
          </div>

          <div className="story-content">
            <p className="section-label">OUR HERITAGE & PASSION</p>

            <h2>
              More Than Just <span>A Meal.</span>
            </h2>

            <div className="story-line"></div>

            <p>At Spicy Spoon, every dish is prepared with rich tradition, hand-pounded spices, and the warmth of home.</p>

            <p>
              From simmering copper pots of butter chicken and slow-cooked dum biryani to clay oven charred tandoori
              delicacies, we celebrate the true spirit of Indian gastronomy.
            </p>

            <button className="story-button" onClick={goToTables}>
              BOOK A TABLE <span>→</span>
            </button>
          </div>
        </div>
      </section>

      {/* ================= MENU SPECIALITIES ================= */}
      <section className="menu-section" id="menu">
        <div className="menu-header">
          <p className="section-tag">CHEF'S SIGNATURE CREATIONS</p>

          <h2>
            Flavours Made <span>To Remember.</span>
          </h2>

          <p className="menu-intro">
            A hand-picked selection of our most celebrated dishes, prepared with authentic ingredients and time-honoured
            recipes.
          </p>
        </div>

        <div className="menu-grid">
          {/* 1 */}
          <div className="menu-card">
            <div className="menu-image">
              <img src={tandooriChicken} alt="Tandoori Chicken" />
            </div>
            <div className="menu-card-content">
              <div className="menu-title-row">
                <h3>Tandoori Chicken</h3>
                <span>₹349</span>
              </div>
              <p>Smoky, juicy chicken marinated in aromatic Kashmiri spices and grilled to perfection.</p>
              <button className="card-order-btn" onClick={() => goToOrder("T1")}>
                + Order at Table
              </button>
            </div>
          </div>

          {/* 2 */}
          <div className="menu-card">
            <div className="menu-image">
              <img src={butterChicken} alt="Butter Chicken" />
            </div>
            <div className="menu-card-content">
              <div className="menu-title-row">
                <h3>Butter Chicken</h3>
                <span>₹329</span>
              </div>
              <p>Tender chicken cooked in a rich, velvety tomato and butter gravy with kasuri methi.</p>
              <button className="card-order-btn" onClick={() => goToOrder("T1")}>
                + Order at Table
              </button>
            </div>
          </div>

          {/* 3 */}
          <div className="menu-card">
            <div className="menu-image">
              <img src={chickenBiryani} alt="Chicken Biryani" />
            </div>
            <div className="menu-card-content">
              <div className="menu-title-row">
                <h3>Chicken Biryani</h3>
                <span>₹299</span>
              </div>
              <p>Fragrant basmati rice layered with spiced chicken, saffron, caramelised onions, and herbs.</p>
              <button className="card-order-btn" onClick={() => goToOrder("T1")}>
                + Order at Table
              </button>
            </div>
          </div>

          {/* 4 */}
          <div className="menu-card">
            <div className="menu-image">
              <img src={prawnFry} alt="Spicy Prawn Fry" />
            </div>
            <div className="menu-card-content">
              <div className="menu-title-row">
                <h3>Spicy Prawn Fry</h3>
                <span>₹379</span>
              </div>
              <p>Fresh coastal prawns tossed with crushed black pepper, curry leaves, and bold spices.</p>
              <button className="card-order-btn" onClick={() => goToOrder("T1")}>
                + Order at Table
              </button>
            </div>
          </div>

          {/* 5 */}
          <div className="menu-card">
            <div className="menu-image">
              <img src={paneerTikka} alt="Paneer Tikka" />
            </div>
            <div className="menu-card-content">
              <div className="menu-title-row">
                <h3>Paneer Tikka</h3>
                <span>₹249</span>
              </div>
              <p>Soft cottage cheese cubes marinated in spiced yogurt and chargrilled with crunchy peppers.</p>
              <button className="card-order-btn" onClick={() => goToOrder("T1")}>
                + Order at Table
              </button>
            </div>
          </div>

          {/* 6 */}
          <div className="menu-card">
            <div className="menu-image">
              <img src={gulabJamun} alt="Gulab Jamun" />
            </div>
            <div className="menu-card-content">
              <div className="menu-title-row">
                <h3>Gulab Jamun Delight</h3>
                <span>₹149</span>
              </div>
              <p>Soft golden milk dumplings soaked in cardamom and rose sugar syrup for a heavenly finish.</p>
              <button className="card-order-btn" onClick={() => goToOrder("T1")}>
                + Order at Table
              </button>
            </div>
          </div>
        </div>

        <div className="view-full-menu-row">
          <button className="full-menu-action-btn" onClick={() => goToOrder("T1")}>
            VIEW COMPLETE MENU & REAL-TIME CART (10+ DISHES) →
          </button>
        </div>
      </section>

      {/* ================= CONTACT & LOCATION ================= */}
      <section className="contact-section" id="contact">
        <div className="contact-content">
          <div className="contact-left">
            <p className="section-tag">GET IN TOUCH</p>

            <h2>
              Visit <span>Spicy Spoon.</span>
            </h2>

            <p className="contact-description">
              Come experience authentic flavours, warm hospitality, and unforgettable moments with your family and
              friends.
            </p>

            <div className="contact-details">
              <div className="contact-item">
                <MapPin size={20} className="contact-icon" />
                <div>
                  <span>LOCATION</span>
                  <p>Tiruppur-Palladam Road, Tamil Nadu</p>
                </div>
              </div>

              <div className="contact-item">
                <Phone size={20} className="contact-icon" />
                <div>
                  <span>PHONE</span>
                  <p>+91 73958 77142</p>
                </div>
              </div>

              <div className="contact-item">
                <Clock size={20} className="contact-icon" />
                <div>
                  <span>OPENING HOURS</span>
                  <p>Everyday · 11:00 AM – 11:00 PM</p>
                </div>
              </div>
            </div>
          </div>

          <div className="contact-right">
            <p className="contact-small-title">RESERVE YOUR TABLE</p>
            <h3>
              Good food is better <br /> when shared together.
            </h3>
            <button className="contact-button" onClick={goToTables}>
              BOOK A TABLE →
            </button>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <div className="footer-top">
          <div className="footer-brand">
            <h2>
              SPICY <span>SPOON</span>
            </h2>
            <p>Authentic flavours, warm hospitality and unforgettable dining experiences.</p>
          </div>

          <div className="footer-links">
            <h4>EXPLORE</h4>
            <a href="#home">Home</a>
            <a href="#story">Our Story</a>
            <a href="#menu">Menu</a>
            <a href="#contact">Contact</a>
            <a href="#/restaurant/spicy-spoon/tables">Book a Table</a>
          </div>

          <div className="footer-contact">
            <h4>DINING</h4>
            <a href="#/restaurant/spicy-spoon/tables">Table Floor Map</a>
            <a href="#/order?table=T1">Dine-in Order</a>
            <a href="#/bill">Live Bill & Settle</a>
            <a href="#/session/SESSION-DEFAULT">Guest Dining Session</a>
          </div>

          <div className="footer-hours">
            <h4>OPENING HOURS</h4>
            <p>Everyday</p>
            <p>11:00 AM – 11:00 PM</p>
            <div className="staff-portal-footer-link">
              <a href="#/staff/login" className="subtle-staff-btn">
                🔒 Staff Portal
              </a>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 Spicy Spoon. All rights reserved.</p>
          <p>Made with passion for authentic food & seamless guest dining technology.</p>
        </div>
      </footer>
    </main>
  );
}

export default App;