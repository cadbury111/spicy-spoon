import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  Utensils,
  MapPin,
  ShieldCheck,
  X,
  Printer,
  ChevronRight,
  Info,
  Check,
  BookmarkCheck,
} from "lucide-react";
import confetti from "canvas-confetti";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./VisualTableBooking.css";

const TIME_SLOTS = [
  { time: "12:00 PM", label: "12:00 PM (Lunch)" },
  { time: "01:00 PM", label: "01:00 PM (Lunch)" },
  { time: "02:00 PM", label: "02:00 PM (Lunch)" },
  { time: "07:00 PM", label: "07:00 PM (Dinner)" },
  { time: "07:30 PM", label: "07:30 PM (Dinner)" },
  { time: "08:30 PM", label: "08:30 PM (Dinner)" },
  { time: "09:30 PM", label: "09:30 PM (Late Dinner)" },
];

const SECTIONS = [
  { name: "Main Hall", desc: "Vibrant indoor dining with warm ambient lights", icon: "🏛️" },
  { name: "Window Side", desc: "Scenic boulevard view with natural ambiance", icon: "🪟" },
  { name: "Outdoor Patio", desc: "Al-fresco garden seating under starry skies", icon: "🌿" },
  { name: "VIP Lounge", desc: "Exclusive plush booths for family gatherings", icon: "👑" },
];

function VisualTableBooking({ slug = "spicy-spoon" }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedTime, setSelectedTime] = useState("07:30 PM");
  const [guestCount, setGuestCount] = useState(2);

  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState(null);

  // Booking Form & Modal
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [bookingForm, setBookingForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    special_notes: "",
  });

  // Fetch Tables & Availability
  const fetchAvailability = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage("");
      const data = await api.getRestaurantTables(slug, {
        date: selectedDate,
        time: selectedTime,
        guests: guestCount,
      });
      setTables(data || []);

      // If selected table is no longer available, unselect it
      if (selectedTable) {
        const updated = data.find((t) => t.id === selectedTable.id || t.table_number === selectedTable.table_number);
        if (!updated || !updated.isAvailableForSlot) {
          setSelectedTable(null);
        } else {
          setSelectedTable(updated);
        }
      }
    } catch (err) {
      console.error("Availability error:", err);
      setErrorMessage("Could not load table availability. Please check your network.");
    } finally {
      setLoading(false);
    }
  }, [slug, selectedDate, selectedTime, guestCount, selectedTable]);

  useEffect(() => {
    fetchAvailability();
  }, [selectedDate, selectedTime, guestCount]);

  // WebSocket Live Updates
  const handleWsEvent = useCallback(
    (event) => {
      if (
        event?.type === "NEW_BOOKING" ||
        event?.type === "TABLE_STATUS_UPDATED" ||
        event?.type === "BOOKING_STATUS_UPDATED"
      ) {
        fetchAvailability();
      }
    },
    [fetchAvailability]
  );

  useWebSocket(handleWsEvent);

  // Group tables by section
  const sectionTables = useMemo(() => {
    const grouped = {};
    for (const sec of SECTIONS) {
      grouped[sec.name] = tables.filter((t) => t.section === sec.name);
    }
    return grouped;
  }, [tables]);

  const handleSelectTable = (table) => {
    if (!table.isAvailableForSlot) {
      if (table.capacity < guestCount) {
        alert(`Table ${table.table_number} fits max ${table.capacity} guests. You requested ${guestCount} guests.`);
      } else {
        alert(`Table ${table.table_number} is already booked for this slot (${table.conflictReason || "Reserved"}).`);
      }
      return;
    }
    setSelectedTable(table);
  };

  const handleDirectBook = (table, e) => {
    e.stopPropagation();
    if (!table.isAvailableForSlot) return;
    setSelectedTable(table);
    setShowBookingModal(true);
  };

  const handleSubmitBooking = async (e) => {
    e.preventDefault();
    if (!selectedTable) return;

    try {
      setIsSubmitting(true);
      setErrorMessage("");

      const payload = {
        table_id: selectedTable.id,
        table_number: selectedTable.table_number,
        customer_name: bookingForm.customer_name.trim(),
        customer_phone: bookingForm.customer_phone.trim(),
        customer_email: bookingForm.customer_email.trim(),
        booking_date: selectedDate,
        start_time: selectedTime,
        guest_count: Number(guestCount),
        special_notes: bookingForm.special_notes.trim(),
      };

      const res = await api.createBooking(payload);

      if (res.booking) {
        setConfirmedBooking(res.booking);
        setShowBookingModal(false);

        // Store active session reference for customer
        if (res.session_id) {
          localStorage.setItem("spicy_last_session", res.session_id);
          localStorage.setItem("spicy_last_table", selectedTable.table_number);
        }

        // Fire celebration confetti
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch (e) {
          // confetti optional
        }

        // Refresh tables list
        fetchAvailability();
      }
    } catch (err) {
      console.error("Booking error:", err);
      setErrorMessage(err.message || "Failed to confirm table booking. Please choose another table.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableCount = tables.filter((t) => t.isAvailableForSlot).length;

  return (
    <div className="table-booking-page">
      {/* Top Navbar */}
      <header className="booking-navbar">
        <a href="#home" className="back-link">
          <ArrowLeft size={18} />
          <span>Back to Restaurant</span>
        </a>

        <div className="nav-center">
          <div className="brand-badge">
            <Sparkles size={14} />
            <span>LIVE RESTAURANT FLOOR MAP</span>
          </div>
          <h1>
            SPICY <span>SPOON</span> TABLE RESERVATIONS
          </h1>
        </div>

        <button className="refresh-btn" onClick={fetchAvailability} title="Refresh Floor Availability">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          <span>Refresh</span>
        </button>
      </header>

      {/* Date, Time & Party Size Filter Controls */}
      <section className="booking-filters-bar">
        <div className="filter-item">
          <label>
            <Calendar size={16} /> Select Dining Date
          </label>
          <input
            type="date"
            min={new Date().toISOString().split("T")[0]}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>

        <div className="filter-item">
          <label>
            <Clock size={16} /> Select Time Slot
          </label>
          <select value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)}>
            {TIME_SLOTS.map((slot) => (
              <option key={slot.time} value={slot.time}>
                {slot.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-item">
          <label>
            <Users size={16} /> Number of Guests ({guestCount} Guests)
          </label>
          <div className="guests-counter">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
              <button
                key={num}
                type="button"
                className={`guest-chip ${guestCount === num ? "active" : ""}`}
                onClick={() => setGuestCount(num)}
              >
                {num} {num === 1 ? "Guest" : "Guests"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Persistent Selection & Booking CTA Banner */}
      <div className="table-booking-status-banner">
        {selectedTable ? (
          <div className="status-banner-selected">
            <div className="banner-left">
              <span className="selected-tag">SELECTED TABLE</span>
              <h3>
                Table {selectedTable.table_number} ({selectedTable.section}) · Fits {selectedTable.capacity} Guests
              </h3>
              <p>
                📅 {selectedDate} · ⏰ {selectedTime} · 👥 {guestCount} Guests
              </p>
            </div>
            <button className="btn-primary-reserve" onClick={() => setShowBookingModal(true)}>
              <BookmarkCheck size={20} />
              <span>BOOK TABLE {selectedTable.table_number} NOW →</span>
            </button>
          </div>
        ) : (
          <div className="status-banner-instruction">
            <div className="instruction-info">
              <span className="step-tag">STEP 1: CHOOSE A TABLE</span>
              <p>
                Found <strong>{availableCount} tables available</strong> for {guestCount} guests on {selectedDate} at{" "}
                {selectedTime}. Click on any green table below to book.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Floor Legend */}
      <div className="floor-legend-bar">
        <div className="legend-item available">
          <span className="legend-dot green"></span>
          <span>Available to Book</span>
        </div>
        <div className="legend-item selected">
          <span className="legend-dot orange"></span>
          <span>Selected Table</span>
        </div>
        <div className="legend-item reserved">
          <span className="legend-dot yellow"></span>
          <span>Reserved / Booked</span>
        </div>
        <div className="legend-item disabled">
          <span className="legend-dot gray"></span>
          <span>Capacity Too Small (&lt; {guestCount} Seats)</span>
        </div>
      </div>

      {errorMessage && (
        <div className="booking-error-banner">
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Floor Layout by Sections */}
      <main className="floor-sections-container">
        {loading && tables.length === 0 ? (
          <div className="floor-loading-state">
            <RefreshCw size={36} className="spin" />
            <p>Scanning floor availability...</p>
          </div>
        ) : (
          <div className="sections-grid">
            {SECTIONS.map((sec) => {
              const secTbls = sectionTables[sec.name] || [];

              return (
                <section className="section-card" key={sec.name}>
                  <div className="section-header">
                    <div className="section-title-wrap">
                      <span className="section-icon">{sec.icon}</span>
                      <div>
                        <h3>{sec.name}</h3>
                        <p>{sec.desc}</p>
                      </div>
                    </div>
                    <span className="section-capacity-tag">
                      {secTbls.filter((t) => t.isAvailableForSlot).length} of {secTbls.length} Available
                    </span>
                  </div>

                  <div className="tables-stage">
                    {secTbls.map((table) => {
                      const isSelected = selectedTable?.id === table.id;
                      const isLowCapacity = table.capacity < guestCount;
                      const isBooked = !table.isAvailableForSlot && !isLowCapacity;

                      let statusClass = "available";
                      if (isSelected) statusClass = "selected";
                      else if (isLowCapacity) statusClass = "disabled-capacity";
                      else if (table.slotStatus === "RESERVED" || !table.isAvailableForSlot) statusClass = "reserved";
                      else if (table.status === "OCCUPIED" || table.status === "ORDER_PLACED") statusClass = "occupied";

                      return (
                        <div
                          key={table.id}
                          className={`restaurant-table-box ${statusClass}`}
                          onClick={() => handleSelectTable(table)}
                        >
                          <div className="table-top-dish">
                            <Utensils size={14} />
                          </div>
                          <div className="table-name-label">{table.table_number}</div>
                          <div className="table-capacity-label">👥 {table.capacity} Seats</div>

                          {/* Direct Action Inside Card */}
                          {table.isAvailableForSlot && !isSelected && (
                            <button
                              type="button"
                              className="btn-card-quick-book"
                              onClick={(e) => handleDirectBook(table, e)}
                            >
                              Book →
                            </button>
                          )}

                          {isSelected && (
                            <button
                              type="button"
                              className="btn-card-selected-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowBookingModal(true);
                              }}
                            >
                              ✓ Reserve Now
                            </button>
                          )}

                          {isLowCapacity && <div className="table-status-pill">Max {table.capacity}</div>}
                          {isBooked && <div className="table-status-pill">Booked</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Selection Drawer / Action Footer */}
      {selectedTable && (
        <div className="floating-booking-drawer">
          <div className="drawer-info">
            <div className="selected-tbl-indicator">
              <span className="tbl-highlight">{selectedTable.table_number}</span>
              <div>
                <h4>{selectedTable.section}</h4>
                <p>
                  📅 {selectedDate} · ⏰ {selectedTime} · 👥 {guestCount} Guests (Capacity: {selectedTable.capacity})
                </p>
              </div>
            </div>
          </div>
          <button className="confirm-proceed-btn" onClick={() => setShowBookingModal(true)}>
            <span>Proceed to Reserve Table {selectedTable.table_number}</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Booking Form Modal */}
      {showBookingModal && selectedTable && (
        <div className="modal-backdrop" onClick={() => setShowBookingModal(false)}>
          <div className="booking-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow-tag">STEP 2 OF 2</span>
                <h3>Confirm Table Reservation</h3>
                <p>
                  Table {selectedTable.table_number} ({selectedTable.section}) · {selectedDate} at {selectedTime}
                </p>
              </div>
              <button className="close-modal-btn" onClick={() => setShowBookingModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitBooking} className="booking-guest-form">
              <div className="form-grid-dual">
                <div className="input-group">
                  <label>Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Anand Mahindra"
                    value={bookingForm.customer_name}
                    onChange={(e) => setBookingForm({ ...bookingForm, customer_name: e.target.value })}
                  />
                </div>

                <div className="input-group">
                  <label>Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={bookingForm.customer_phone}
                    onChange={(e) => setBookingForm({ ...bookingForm, customer_phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>Email Address (For Confirmation)</label>
                <input
                  type="email"
                  placeholder="anand@example.com"
                  value={bookingForm.customer_email}
                  onChange={(e) => setBookingForm({ ...bookingForm, customer_email: e.target.value })}
                />
              </div>

              <div className="input-group">
                <label>Special Celebration or Food Request (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Birthday anniversary, high chair needed for child, window table preference"
                  value={bookingForm.special_notes}
                  onChange={(e) => setBookingForm({ ...bookingForm, special_notes: e.target.value })}
                />
              </div>

              <div className="booking-summary-box">
                <div className="summary-row">
                  <span>Reserved Table</span>
                  <strong>
                    {selectedTable.table_number} ({selectedTable.section})
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Date & Slot</span>
                  <strong>
                    {selectedDate} at {selectedTime}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Party Size</span>
                  <strong>👥 {guestCount} Guests</strong>
                </div>
                <div className="summary-row">
                  <span>Booking Duration</span>
                  <strong>90 Minutes (Standard Dining)</strong>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowBookingModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={16} className="spin" /> Locking Table...
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={18} /> Confirm Reservation Now →
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Success Screen */}
      {confirmedBooking && (
        <div className="modal-backdrop" onClick={() => setConfirmedBooking(null)}>
          <div className="confirmation-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="success-badge-icon">
              <CheckCircle2 size={54} />
            </div>

            <h2>Booking Confirmed! ✓</h2>
            <p className="success-sub">We are thrilled to host you at Spicy Spoon.</p>

            <div className="digital-ticket">
              <div className="ticket-header">
                <div>
                  <span className="ticket-label">BOOKING REFERENCE</span>
                  <h3>#{confirmedBooking.booking_number}</h3>
                </div>
                <span className="ticket-badge-confirmed">CONFIRMED</span>
              </div>

              <div className="ticket-divider"></div>

              <div className="ticket-details-grid">
                <div>
                  <span>Table Number</span>
                  <strong>{confirmedBooking.table_number}</strong>
                </div>
                <div>
                  <span>Section</span>
                  <strong>{confirmedBooking.section || "Main Hall"}</strong>
                </div>
                <div>
                  <span>Date</span>
                  <strong>{confirmedBooking.booking_date}</strong>
                </div>
                <div>
                  <span>Dining Time</span>
                  <strong>
                    {confirmedBooking.start_time} – {confirmedBooking.end_time}
                  </strong>
                </div>
                <div>
                  <span>Guests</span>
                  <strong>👥 {confirmedBooking.guest_count} People</strong>
                </div>
                <div>
                  <span>Primary Guest</span>
                  <strong>{confirmedBooking.customer_name}</strong>
                </div>
              </div>

              <div className="ticket-footer-note">
                <Info size={14} />
                <span>Please arrive 5–10 minutes prior to your time slot. Table will be held for 15 minutes.</span>
              </div>
            </div>

            <div className="confirmation-actions">
              <button
                className="btn-order-now"
                onClick={() => {
                  window.location.hash = `#/order?table=${confirmedBooking.table_number}`;
                }}
              >
                <Utensils size={16} /> Pre-order / View Digital Menu →
              </button>
              <button className="btn-print-ticket" onClick={() => window.print()}>
                <Printer size={16} /> Print Confirmation
              </button>
              <button className="btn-close-ticket" onClick={() => setConfirmedBooking(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VisualTableBooking;
