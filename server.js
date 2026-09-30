import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import offerRoutes from './routes/offers.js';
import orderRoutes from './routes/orders.js';
import qualityRoutes from './routes/quality.js';
import adminRoutes from './routes/admin.js';
import adminOrderRoutes from './routes/adminOrders.js';
import kycRoutes from './routes/kyc.js';
import mandiRoutes from './routes/mandi.js';
import weatherRoutes from './routes/weather.js';
import logisticsRoutes from './routes/logistics.js';
import logisticsShipmentRoutes from './routes/logisticsShipments.js';
import varietyMasterRoutes from './routes/varietyMaster.js';
import commodityMasterRoutes from './routes/commodityMaster.js';
import warehouseMasterRoutes from './routes/warehouseMaster.js';
import locationMasterRoutes from './routes/locationMaster.js';
import purchaseOrderRoutes from './routes/purchaseOrders.js';
import saleOrderRoutes from './routes/saleOrders.js';
import confirmedSalesOrderRoutes from './routes/confirmedSalesOrders.js';
import confirmedPurchaseOrderRoutes from './routes/confirmedPurchaseOrders.js';
import reportRoutes from './routes/reports.js';
import uploadRoutes from './routes/uploads.js';
import supplyTransactionRoutes from './routes/supplyTransactions.js';
// COMMENTED OUT: Cashfree and Aadhaar verification APIs - using simple registration now
// import cashfreeKYCRoutes from './routes/cashfreeKYC.js';
// import sandboxKYCRoutes from './routes/sandboxKYC.js';
import registrationRoutes from './routes/registration.js';
import analyticsRoutes from './routes/analytics.js';
import documentViewRoutes from './routes/documentView.js';
import siteSettingsRoutes from './routes/siteSettings.js';
import contactInquiryRoutes from './routes/contactInquiries.js';
import agmarknetRoutes from './routes/agmarknet.js';
import { startAgmarknetCron } from './jobs/agmarknetCron.js';

dotenv.config();

const app = express();
app.get('/', (req, res) => {
  res.status(200).json({ status: "success", message: "Grainology API is running" });
});
const PORT = process.env.PORT || 3001;
const DB_RETRY_INTERVAL_MS = Number(process.env.DB_RETRY_INTERVAL_MS || 10000);
let dbRetryTimer = null;

const getMongoConnectionAttempts = () => {
  const primaryUri = process.env.MONGODB_URI;
  const directUri = process.env.MONGODB_DIRECT_URI;
  const preferDirect = String(process.env.MONGODB_PREFER_DIRECT || '').trim().toLowerCase() === 'true';
  const attempts = [];

  if (directUri && preferDirect) {
    attempts.push({ label: 'MONGODB_DIRECT_URI', uri: directUri });
  }

  if (primaryUri) {
    attempts.push({ label: 'MONGODB_URI', uri: primaryUri });
  }

  if (directUri && !preferDirect) {
    attempts.push({ label: 'MONGODB_DIRECT_URI', uri: directUri });
  }

  // Some local Windows/ISP DNS setups refuse MongoDB SRV lookups even when
  // the Atlas hosts themselves are reachable. Keep the public Atlas SRV URI as
  // the default, but retry with the equivalent seed-list URI for this cluster.
  try {
    const parsed = primaryUri ? new URL(primaryUri) : null;
    if (parsed?.protocol === 'mongodb+srv:' && parsed.host === 'grainology.we2saem.mongodb.net') {
      const directUri = [
        `mongodb://${parsed.username}:${parsed.password}@`,
        'ac-ixzgchw-shard-00-00.we2saem.mongodb.net:27017,',
        'ac-ixzgchw-shard-00-01.we2saem.mongodb.net:27017,',
        'ac-ixzgchw-shard-00-02.we2saem.mongodb.net:27017',
        parsed.pathname || '/grainology',
        '?ssl=true&authSource=admin&replicaSet=atlas-xmu1w9-shard-0&retryWrites=true&w=majority'
      ].join('');

      attempts.push({ label: 'resolved Atlas seed-list fallback', uri: directUri });
    }
  } catch (error) {
    console.warn('Unable to prepare MongoDB fallback URI:', error.message);
  }

  return attempts;
};

// -----------------------------
// CORS CONFIG
// -----------------------------

const normalizeOrigin = (origin) => {
  const rawOrigin = String(origin || '').trim();
  if (!rawOrigin) return '';

  try {
    const parsed = new URL(rawOrigin);
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return rawOrigin.replace(/\/$/, '').toLowerCase();
  }
};

const parseOrigins = (value) => String(value || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const isTrustedRenderOrigin = (origin) => /^https:\/\/grainology(?:-[a-z0-9-]+)?\.onrender\.com$/i.test(origin);
const backendRenderOrigin = normalizeOrigin(process.env.RENDER_EXTERNAL_URL || 'https://grainology-xcg8.onrender.com');

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://grainologyagri.com',
  'https://www.grainologyagri.com',
  backendRenderOrigin,
  process.env.FRONTEND_URL,
  ...parseOrigins(process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS)
]
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOriginSet = new Set(allowedOrigins);

console.log("CORS allowed origins:", allowedOrigins);

const getAllowedOrigin = (origin) => {
  if (!origin) return null;
  const normalized = normalizeOrigin(origin);

  if (allowedOriginSet.has(normalized) || isTrustedRenderOrigin(normalized)) {
    return normalized;
  }

  // Allow local network IPs for development testing
  if (normalized.startsWith('http://192.168.') || normalized.startsWith('http://10.')) {
    return normalized;
  }

  return null;
};

const corsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const corsAllowedHeaders = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Origin',
  'X-Requested-With',
  'Cache-Control',
  'Pragma'
];

const applyCorsHeaders = (req, res) => {
  const allowedOrigin = getAllowedOrigin(req.headers.origin);

  if (allowedOrigin) {
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Access-Control-Allow-Methods', corsMethods.join(','));
  res.header('Access-Control-Allow-Headers', corsAllowedHeaders.join(','));
  res.header('Access-Control-Max-Age', '86400');
};

const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps / curl / postman).
    if (!origin) return callback(null, true);

    if (getAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.log('Blocked CORS origin:', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: corsMethods,
  allowedHeaders: corsAllowedHeaders,
  optionsSuccessStatus: 204
};

// Apply CORS headers to all responses
app.use((req, res, next) => {
  applyCorsHeaders(req, res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Additional CORS middleware as fallback
app.use(cors(corsOptions));

// Ensure CORS headers are on all responses including errors
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    applyCorsHeaders(req, res);
    return originalJson.call(this, data);
  };
  next();
});

// trust render proxy for cookies
app.set('trust proxy', 1);

// -----------------------------
// BODY PARSER
// -----------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -----------------------------
// DB CONNECT
// -----------------------------
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI is not set in .env file');
      console.error('💡 Please add MONGODB_URI to your .env file');
      console.error('   Example: MONGODB_URI=mongodb://localhost:27017/grainology');
      console.error('   Or MongoDB Atlas: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/grainology');
      return false;
    }

    const attempts = getMongoConnectionAttempts();
    let conn = null;
    let lastError = null;

    for (const attempt of attempts) {
      try {
        conn = await mongoose.connect(attempt.uri, {
          serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
          socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
        });

        if (attempt.label !== 'MONGODB_URI') {
          console.warn(`MongoDB connected using ${attempt.label}.`);
        }
        break;
      } catch (error) {
        lastError = error;
        console.error(`MongoDB connection attempt failed (${attempt.label}):`, error.message);
        await mongoose.disconnect().catch(() => {});
      }
    }

    if (!conn) {
      throw lastError || new Error('No MongoDB connection attempts were available');
    }

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });

    if (dbRetryTimer) {
      clearTimeout(dbRetryTimer);
      dbRetryTimer = null;
    }

    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed!');
    console.error('Error:', error.message);
    console.error('\n💡 Troubleshooting tips:');
    console.error('   1. Check your MONGODB_URI in .env file');
    console.error('   2. If using MongoDB Atlas: Check IP whitelist (allow 0.0.0.0/0 for testing)');
    console.error('   3. If using local MongoDB: Ensure MongoDB service is running');
    console.error('   4. Verify your connection string format');
    console.error('   5. Check your network connection');
    return false;
  }
};

const scheduleDbReconnect = () => {
  if (dbRetryTimer) return;
  dbRetryTimer = setTimeout(async () => {
    dbRetryTimer = null;
    console.log(`🔁 Retrying MongoDB connection...`);
    const connected = await connectDB();
    if (!connected) {
      scheduleDbReconnect();
    }
  }, DB_RETRY_INTERVAL_MS);
};

(async () => {
  const connected = await connectDB();
  if (!connected) {
    console.warn('⚠️  Starting API without DB connection. DB-backed routes will return 503 until MongoDB reconnects.');
    scheduleDbReconnect();
  }
})();

// -----------------------------
// HEALTH CHECK
// -----------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// -----------------------------
// API ROUTES
// -----------------------------
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/mandi', mandiRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/logistics-shipments', logisticsShipmentRoutes);
app.use('/api/variety-master', varietyMasterRoutes);
app.use('/api/commodity-master', commodityMasterRoutes);
app.use('/api/warehouse-master', warehouseMasterRoutes);
app.use('/api/location-master', locationMasterRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/sale-orders', saleOrderRoutes);
app.use('/api/confirmed-sales-orders', confirmedSalesOrderRoutes);
app.use('/api/confirmed-purchase-orders', confirmedPurchaseOrderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/supply-transactions', supplyTransactionRoutes);
// COMMENTED OUT: Cashfree and Aadhaar verification APIs - using simple registration now
// app.use('/api/cashfree/kyc', cashfreeKYCRoutes);
// app.use('/api/sandbox/kyc', sandboxKYCRoutes);
app.use('/api/registration', registrationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/documents', documentViewRoutes);
app.use('/api/site-settings', siteSettingsRoutes);
app.use('/api/contact-inquiries', contactInquiryRoutes);
app.use('/api/agmarknet', agmarknetRoutes);

// -----------------------------
// ERROR HANDLER
// -----------------------------
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.message);
  console.error('Stack:', err.stack);
  
  applyCorsHeaders(req, res);
  
  // Default to 500 if no status code is set
  const status = res.statusCode === 200 ? 500 : res.statusCode;
  
  res.status(status).json({ 
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// -----------------------------
// 404
// -----------------------------
app.use((req, res) => {
  applyCorsHeaders(req, res);
  res.status(404).json({ error: 'Route not found' });
});

// -----------------------------
// START SERVER
// ----
const server = app.listen(PORT, '0.0.0.0', () => {
  startAgmarknetCron();
  console.log(`AI predictions source: ${process.env.AI_PREDICTIONS_SOURCE || 'local_files'}`);
  console.log(`✅ API running on http://0.0.0.0:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});
