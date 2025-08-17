const http = require('http');
const url = require('url');

// Mock data
const mockUser = {
  id: '1',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  tenantId: 'tenant-1'
};

const mockReservations = [
  {
    reservation_id: 'res-1',
    store_id: 'store-1',
    member_id: 'customer-1',
    menu_id: 'service-1',
    staff_id: 'staff-1',
    start_at: new Date(Date.now() + 3600000).toISOString(),
    end_at: new Date(Date.now() + 5400000).toISOString(),
    status: 'confirmed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    reservation_id: 'res-2',
    store_id: 'store-1',
    member_id: 'customer-2',
    menu_id: 'service-2',
    staff_id: 'staff-2',
    start_at: new Date(Date.now() + 7200000).toISOString(),
    end_at: new Date(Date.now() + 10800000).toISOString(),
    status: 'confirmed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    reservation_id: 'res-3',
    store_id: 'store-1',
    member_id: 'customer-3',
    menu_id: 'service-1',
    staff_id: null,
    start_at: new Date(Date.now() - 3600000).toISOString(),
    end_at: new Date(Date.now() - 1800000).toISOString(),
    status: 'completed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

const mockBookings = [
  {
    id: '1',
    customerId: 'customer-1',
    customerName: '田中太郎',
    customerEmail: 'tanaka@example.com',
    serviceId: 'service-1',
    serviceName: 'カット',
    resourceId: 'resource-1',
    resourceName: 'スタイリストA',
    startTime: new Date(Date.now() + 3600000).toISOString(),
    endTime: new Date(Date.now() + 5400000).toISOString(),
    status: 'confirmed',
    totalAmount: 3000,
    notes: '初めてのご来店',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '2',
    customerId: 'customer-2',
    customerName: '佐藤花子',
    customerEmail: 'sato@example.com',
    serviceId: 'service-2',
    serviceName: 'カラー',
    resourceId: 'resource-2',
    resourceName: 'スタイリストB',
    startTime: new Date(Date.now() + 7200000).toISOString(),
    endTime: new Date(Date.now() + 10800000).toISOString(),
    status: 'pending',
    totalAmount: 8000,
    notes: 'アレルギー注意',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Build CORS headers per request
function buildCorsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-ID',
    'Access-Control-Allow-Credentials': 'true'
  };
}

// Create server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;
  
  console.log(`[${new Date().toISOString()}] ${method} ${path} from ${req.headers.origin || 'no origin'}`);;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    const corsHeaders = buildCorsHeaders(req);
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  // Set CORS headers for all responses
  const corsHeaders = buildCorsHeaders(req);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.setHeader('Content-Type', 'application/json');

  // Routes
  if (path === '/v1/auth/login' && method === 'POST') {
    // Mock login
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        console.log(`[${new Date().toISOString()}] Login request body:`, body);
        const data = body ? JSON.parse(body) : {};
        if (data.email === 'admin@example.com' && data.password === 'password123') {
          res.writeHead(200);
          res.end(JSON.stringify({
            user: mockUser,
            token: 'mock-jwt-token',
            accessToken: 'mock-jwt-token',
            refreshToken: 'mock-refresh-token'
          }));
          console.log(`[${new Date().toISOString()}] Login successful for ${data.email}`);
        } else {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
          console.log(`[${new Date().toISOString()}] Login failed for ${data.email || 'unknown'}`);
        }
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error processing login:`, err);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return; // Important: prevent further processing
  } else if (path === '/v1/auth/me' && method === 'GET') {
    // Mock get current user
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      res.writeHead(200);
      res.end(JSON.stringify(mockUser));
    } else {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    return;
  } else if (path === '/v1/auth/logout' && method === 'POST') {
    // Mock logout
    res.writeHead(200);
    res.end(JSON.stringify({ message: 'Logged out successfully' }));
  } else if (path === '/v1/reservations' && method === 'GET') {
    // Mock get reservations (snake_case API)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Filter by date range if provided
      let filteredReservations = [...mockReservations];
      
      if (parsedUrl.query.from) {
        const fromDate = new Date(parsedUrl.query.from);
        filteredReservations = filteredReservations.filter(
          res => new Date(res.start_at) >= fromDate
        );
      }
      
      if (parsedUrl.query.to) {
        const toDate = new Date(parsedUrl.query.to);
        filteredReservations = filteredReservations.filter(
          res => new Date(res.start_at) < toDate
        );
      }
      
      res.writeHead(200);
      res.end(JSON.stringify(filteredReservations));
    } else {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
  } else if (path.match(/^\/v1\/reservations\/[^/]+$/) && method === 'PATCH') {
    // Mock update reservation
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const reservationId = path.split('/').pop();
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const data = JSON.parse(body);
        const reservation = mockReservations.find(r => r.reservation_id === reservationId);
        if (reservation) {
          if (data.status) reservation.status = data.status;
          reservation.updated_at = new Date().toISOString();
          res.writeHead(200);
          res.end(JSON.stringify(reservation));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Reservation not found' }));
        }
      });
    } else {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
  } else if (path === '/v1/bookings' && method === 'GET') {
    // Mock get bookings
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const limit = parseInt(parsedUrl.query.limit) || 20;
      const page = parseInt(parsedUrl.query.page) || 1;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      
      res.writeHead(200);
      res.end(JSON.stringify({
        items: mockBookings.slice(startIndex, endIndex),
        pagination: {
          total: mockBookings.length,
          page: page,
          limit: limit,
          totalPages: Math.ceil(mockBookings.length / limit)
        }
      }));
    } else {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
  } else if (path === '/health' && method === 'GET') {
    // Health check
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    // Not found
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mock backend server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /v1/auth/login - Login (admin@example.com / password123)');
  console.log('  GET  /v1/auth/me - Get current user');
  console.log('  POST /v1/auth/logout - Logout');
  console.log('  GET  /v1/reservations - Get reservations list');
  console.log('  PATCH /v1/reservations/:id - Update reservation');
  console.log('  GET  /v1/bookings - Get bookings list');
  console.log('  GET  /health - Health check');
  console.log('\nFrontend should be running at: http://localhost:5174');
});