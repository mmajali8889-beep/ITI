import {
  Activity,
  BedDouble,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  FlaskConical,
  HeartPulse,
  House,
  LogOut,
  Menu,
  Microscope,
  Pill,
  Search,
  Settings,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';

import {
  NavLink,
  Outlet,
  useNavigate,
} from 'react-router-dom';

import {
  useState,
} from 'react';

import {
  useHospital,
} from '../context/HospitalContext';

import './EHRLayout.css';

export default function EHRLayout() {
  const navigate =
    useNavigate();

  const {
    hospital,
    clearHospital,
  } = useHospital();

  const [
    sidebarOpen,
    setSidebarOpen,
  ] =
    useState(false);

  const [
    userMenuOpen,
    setUserMenuOpen,
  ] =
    useState(false);

  function changeHospital() {
    clearHospital();

    navigate('/');
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <div className="ehr-shell">

      {/* =====================================================
          MOBILE OVERLAY
      ===================================================== */}

      {sidebarOpen && (
        <button
          type="button"
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={closeSidebar}
        />
      )}


      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside
        className={
          sidebarOpen
            ? 'ehr-sidebar open'
            : 'ehr-sidebar'
        }
      >

        <div className="sidebar-header">

          <button
            type="button"
            className="brand-area"
            onClick={() => {
              if (!hospital?.id) {
                return;
              }

              navigate(
                `/hospital/${hospital.id}/dashboard`,
              );

              closeSidebar();
            }}
          >

            <div className="brand-logo">
              <HeartPulse
                size={24}
                strokeWidth={2.2}
              />
            </div>


            <div className="brand-text">

              <strong>
                HealthCore
              </strong>

              <span>
                Hospital EHR
              </span>

            </div>

          </button>


          <button
            type="button"
            className="sidebar-close-button"
            onClick={closeSidebar}
          >
            <X size={20} />
          </button>

        </div>


        {/* ===================================================
            CURRENT HOSPITAL
        =================================================== */}

        <div className="sidebar-hospital-card">

          <div className="sidebar-hospital-icon">
            <Building2
              size={18}
            />
          </div>


          <div className="sidebar-hospital-info">

            <span>
              Current Hospital
            </span>

            <strong>
              {hospital?.name ??
                'No Hospital'}
            </strong>

          </div>

        </div>


        {/* ===================================================
            NAVIGATION
        =================================================== */}

        <div className="sidebar-navigation">

          <NavigationSection
            title="Workspace"
          >

            <SidebarLink
              to="dashboard"
              label="Dashboard"
              icon={
                <House size={19} />
              }
              onClick={closeSidebar}
            />


            <SidebarLink
              to="patients"
              label="Patient Search"
              icon={
                <Search size={19} />
              }
              onClick={closeSidebar}
            />


            <SidebarLink
              to="appointments"
              label="Appointments"
              icon={
                <CalendarDays
                  size={19}
                />
              }
              onClick={closeSidebar}
              disabled
            />

          </NavigationSection>


          <NavigationSection
            title="Clinical"
          >

            <SidebarLink
              to="opd"
              label="Outpatient"
              icon={
                <Stethoscope
                  size={19}
                />
              }
              onClick={closeSidebar}
              disabled
            />


            <SidebarLink
              to="emergency"
              label="Emergency"
              icon={
                <Activity size={19} />
              }
              onClick={closeSidebar}
              disabled
            />


            <SidebarLink
              to="inpatient"
              label="Inpatient"
              icon={
                <BedDouble size={19} />
              }
              onClick={closeSidebar}
              disabled
            />

          </NavigationSection>


          <NavigationSection
            title="Diagnostics"
          >

            <SidebarLink
              to="laboratory"
              label="Laboratory"
              icon={
                <FlaskConical
                  size={19}
                />
              }
              onClick={closeSidebar}
              disabled
            />


            <SidebarLink
              to="radiology"
              label="Radiology"
              icon={
                <Microscope
                  size={19}
                />
              }
              onClick={closeSidebar}
              disabled
            />


            <SidebarLink
              to="pharmacy"
              label="Pharmacy"
              icon={
                <Pill size={19} />
              }
              onClick={closeSidebar}
              disabled
            />

          </NavigationSection>


          <NavigationSection
            title="Operations"
          >

            <SidebarLink
              to="beds"
              label="Bed Management"
              icon={
                <BedDouble size={19} />
              }
              onClick={closeSidebar}
              disabled
            />


            <SidebarLink
              to="staff"
              label="Clinical Staff"
              icon={
                <Users size={19} />
              }
              onClick={closeSidebar}
              disabled
            />

          </NavigationSection>

        </div>


        {/* ===================================================
            SIDEBAR FOOTER
        =================================================== */}

        <div className="sidebar-footer">

          <button
            type="button"
            className="sidebar-footer-button"
          >
            <Settings size={18} />

            <span>
              Settings
            </span>
          </button>


          <div className="system-status">

            <span className="system-status-dot" />

            <div>
              <strong>
                System Online
              </strong>

              <span>
                FHIR Connected
              </span>
            </div>

          </div>

        </div>

      </aside>


      {/* =====================================================
          MAIN
      ===================================================== */}

      <div className="ehr-main">

        {/* ===================================================
            TOPBAR
        =================================================== */}

        <header className="ehr-topbar">

          <div className="topbar-left">

            <button
              type="button"
              className="mobile-menu-button"
              onClick={() =>
                setSidebarOpen(
                  true,
                )
              }
            >
              <Menu size={21} />
            </button>


            <div className="topbar-hospital">

              <div className="topbar-hospital-icon">
                <Building2
                  size={18}
                />
              </div>


              <div>

                <span>
                  Current Facility
                </span>

                <strong>
                  {hospital?.name ??
                    'Hospital'}
                </strong>

              </div>

            </div>

          </div>


          <div className="topbar-right">

            <button
              type="button"
              className="change-hospital-button"
              onClick={
                changeHospital
              }
            >
              <Building2
                size={16}
              />

              <span>
                Change Hospital
              </span>
            </button>


            <div className="topbar-divider" />


            <div className="user-menu-wrapper">

              <button
                type="button"
                className="user-menu-trigger"
                onClick={() =>
                  setUserMenuOpen(
                    (current) =>
                      !current,
                  )
                }
              >

                <div className="user-avatar">
                  MA
                </div>


                <div className="user-details">

                  <strong>
                    Mohammad
                  </strong>

                  <span>
                    Administrator
                  </span>

                </div>


                <ChevronDown
                  size={16}
                  className={
                    userMenuOpen
                      ? 'user-menu-chevron open'
                      : 'user-menu-chevron'
                  }
                />

              </button>


              {userMenuOpen && (

                <div className="user-dropdown">

                  <div className="user-dropdown-header">

                    <CircleUserRound
                      size={22}
                    />

                    <div>
                      <strong>
                        Mohammad
                      </strong>

                      <span>
                        System Administrator
                      </span>
                    </div>

                  </div>


                  <div className="user-dropdown-separator" />


                  <button
                    type="button"
                  >
                    <Settings
                      size={16}
                    />

                    Account Settings
                  </button>


                  <button
                    type="button"
                    className="logout-option"
                  >
                    <LogOut
                      size={16}
                    />

                    Sign Out
                  </button>

                </div>

              )}

            </div>

          </div>

        </header>


        {/* ===================================================
            CONTENT
        =================================================== */}

        <main className="ehr-content">

          <Outlet />

        </main>

      </div>

    </div>
  );
}


function NavigationSection({
  title,
  children,
}: {
  title: string;

  children:
    React.ReactNode;
}) {
  return (
    <section className="navigation-section">

      <div className="navigation-section-title">
        {title}
      </div>

      <div className="navigation-section-links">
        {children}
      </div>

    </section>
  );
}


function SidebarLink({
  to,
  label,
  icon,
  onClick,
  disabled = false,
}: {
  to: string;

  label: string;

  icon:
    React.ReactNode;

  onClick:
    () => void;

  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <button
        type="button"
        className="sidebar-link disabled"
        title="Coming soon"
      >

        <span className="sidebar-link-icon">
          {icon}
        </span>

        <span>
          {label}
        </span>

        <small>
          Soon
        </small>

      </button>
    );
  }

  return (
    <NavLink
      to={to}
      end
      onClick={onClick}
      className={({
        isActive,
      }) =>
        isActive
          ? 'sidebar-link active'
          : 'sidebar-link'
      }
    >

      <span className="sidebar-link-icon">
        {icon}
      </span>

      <span>
        {label}
      </span>

    </NavLink>
  );
}