import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import Dashboard from './pages/Dashboard';
import TodayReservations from './pages/TodayReservations';
import MenuSettings from './pages/MenuSettings';
import Reservations from './pages/Reservations';
import Customers from './pages/Customers';
import Settings from './pages/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="today" element={<TodayReservations />} />
          <Route path="menus" element={<MenuSettings />} />
          <Route path="reservations" element={<Reservations />} />
          <Route path="customers" element={<Customers />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App
