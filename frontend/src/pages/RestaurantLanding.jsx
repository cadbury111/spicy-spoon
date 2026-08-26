import { useEffect, useState } from "react";
import {
  Utensils,
  Calendar,
  Clock,
  MapPin,
  Phone,
  QrCode,
  Receipt,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Share2,
  Printer,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api";
import "./RestaurantLanding.css";

import restaurantFront from "../assets/restaurant-front.png";

function RestaurantLanding({ slug = "spicy-spoon", tableParam = null }) {
  const [restaurant, setRestaurant] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Table parameter detection from prop or URL
  const detectedTable = tableParam || (() => {
    const hash = window.location.hash;
    const match = hash.match(/\/table\/([A-Za-z0-9]+)/i);
    return match ? match[1] : null;
  })();

  useEffect(() => {
    const loadRestaurantInfo = async () => {
      try {
        setLoading(true);
        const [rData, qData] = await Promise.all([
          api.getRestaurant(slug).catch(() => null),
          api.getRestaurantQr(slug).catch(() => null),
        ]);
        setRestaurant(rData);
        setQrData(qData);
      } catch (err) {
        console.error("Failed to load restaurant data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadRestaurantInfo();
  }, [slug]);

  const handleStartOrdering = () => {
    const tbl = detectedTable || "T1";
    window.location.hash = `#/restaurant/${slug}/order?table=${tbl}`;
  };

  const handleBookTable = () => {
    window.location.hash = `#/restaurant/${slug}/tables`;
  };

  const handleViewBill = () => {
    const tbl = detectedTable || "T1";
    window.location.hash = `#/bill?table=${tbl}`;
  };

  return (
    <div className="restaurant-portal-page">
      {/* Navbar */}
      <header className="portal-header">
        <div className="portal-brand">
          <a href="#home">
            SPICY <span>SPOON</span>
          </a>
        </div>
        <div className="portal-nav-actions">
          <a href="#home" className="portal-nav-link">
            Home
          </a>
          <button className="btn-portal-reserve" onClick={handleBookTable}>
            <Calendar size={15} /> Book a Table
          </button>
          <button className="btn-portal-order" onClick={handleStartOrdering}>
            <Utensils size={15} /> Dine-in Menu
          </button>
        </div>
      </header>

      {/* TABLE DETECTED BANNER (Phase 4 Specification) */}
      {detectedTable && (
        <section className="table-detected-banner">
          <div className="detected-content">
            <div className="detected-icon-badge">
              <CheckCircle2 size={32} />
            </div>
            <div>
              <span className="welcome-tag">WELCOME TO SPICY SPOON</span>
              <h2>Table {detectedTable} Detected ✓</h2>
              <p>Your dining session is active for Table {detectedTable}. Browse menu, place orders, or request live bill.</p>
            </div>
          </div>
          <div className="detected-actions">
            <button className="btn-order-instant" onClick={handleStartOrdering}>
              <span>Order Food for Table {detectedTable}</span>
              <ArrowRight size={18} />
            </button>
            <button className="btn-bill-instant" onClick={handleViewBill}>
              <Receipt size={16} />
              <span>Live Bill</span>
            </button>
          </div>
        </section>
      )}

      {/* Hero Showcase */}
      <section className="portal-hero" style={{ backgroundImage: `url(${restaurantFront})` }}>
        <div className="portal-hero-overlay"></div>
        <div className="portal-hero-container">
          <div className="hero-pill">
            <Sparkles size={14} />
            <span>FINE DINING & SMART QR SERVICE</span>
          </div>

          <h1>{restaurant?.name || "Spicy Spoon Restaurant"}</h1>
          <p className="hero-tagline">{restaurant?.tagline || "Authentic Flavours. Smoked Tandoori. Warm Hospitality."}</p>

          <div className="portal-action-tiles">
            {/* Tile 1: Table Booking */}
            <div className="action-tile book-tile" onClick={handleBookTable}>
              <div className="tile-icon-box">
                <Calendar size={28} />
              </div>
              <div className="tile-text">
                <h3>Visual Table Booking</h3>
                <p>Pick your favourite seat in Main Hall, Window Side, Patio or VIP Lounge.</p>
              </div>
              <span className="tile-arrow">
                <ChevronRight size={20} />
              </span>
            </div>

            {/* Tile 2: Order at Table */}
            <div className="action-tile order-tile" onClick={handleStartOrdering}>
              <div className="tile-icon-box">
                <Utensils size={28} />
              </div>
              <div className="tile-text">
                <h3>{detectedTable ? `Order at Table ${detectedTable}` : "Scan Table QR / Digital Menu"}</h3>
                <p>Browse 10+ authentic dishes, add cooking instructions, and send to kitchen.</p>
              </div>
              <span className="tile-arrow">
                <ChevronRight size={20} />
              </span>
            </div>

            {/* Tile 3: Live Bill & Payment */}
            <div className="action-tile bill-tile" onClick={handleViewBill}>
              <div className="tile-icon-box">
                <Receipt size={28} />
              </div>
              <div className="tile-text">
                <h3>Live Bill & Settle Payment</h3>
                <p>Instant UPI QR, Card payment & Cash settlements with digital receipt.</p>
              </div>
              <span className="tile-arrow">
                <ChevronRight size={20} />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Info & Permanent Restaurant QR Section */}
      <section className="portal-info-section">
        <div className="info-grid">
          {/* Restaurant Details */}
          <div className="info-card">
            <h3>Restaurant Details</h3>
            <div className="info-item">
              <MapPin size={20} className="info-icon" />
              <div>
                <span>Address</span>
                <p>{restaurant?.address || "Tiruppur-Palladam road, Tamil Nadu"}</p>
              </div>
            </div>
            <div className="info-item">
              <Phone size={20} className="info-icon" />
              <div>
                <span>Phone / Reservations</span>
                <p>{restaurant?.phone || "+91 73958 77142"}</p>
              </div>
            </div>
            <div className="info-item">
              <Clock size={20} className="info-icon" />
              <div>
                <span>Operating Hours</span>
                <p>Everyday · {restaurant?.opening_time || "11:00 AM"} – {restaurant?.closing_time || "11:00 PM"}</p>
              </div>
            </div>
            <div className="info-item">
              <ShieldCheck size={20} className="info-icon" />
              <div>
                <span>Taxes & Service Charge</span>
                <p>GST 5.0% · Service Charge 2.5%</p>
              </div>
            </div>
          </div>

          {/* Permanent QR Display */}
          <div className="qr-card">
            <div className="qr-card-header">
              <QrCode size={22} />
              <h4>Permanent Restaurant QR</h4>
            </div>
            <p className="qr-desc">Scan to visit this restaurant portal or share with your dining party.</p>

            {qrData?.qrCodeDataUrl ? (
              <div className="qr-display-box">
                <img src={qrData.qrCodeDataUrl} alt="Spicy Spoon QR Code" className="portal-qr-img" />
                <span className="qr-target-url">{qrData.targetUrl}</span>
              </div>
            ) : (
              <div className="qr-loading-box">Generating Permanent QR...</div>
            )}

            <div className="qr-actions">
              <a
                href={qrData?.qrCodeDataUrl}
                download="spicy-spoon-restaurant-qr.png"
                className="btn-qr-download"
              >
                Download QR Code (PNG)
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default RestaurantLanding;
