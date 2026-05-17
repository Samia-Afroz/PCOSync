// ✅ ENV MUST LOAD FIRST
import "dotenv/config";

import express from "express";
import cors from "cors";
import cron from "node-cron";

import { connectDB, closeDB } from "./config/db.js";

// =========================
// ROUTES
// =========================
import routes from "./routes/index.js";
import statsRoutes from "./routes/statsRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import medicalDetailsRoutes from "./routes/medicalDetailsRoutes.js";
import cycleRoutes from "./routes/cycleRoutes.js";
import cycleStatsRoutes from "./routes/cycleStatsRoutes.js";

import mealRoutes from "./routes/mealRoutes.js";
import waterRoutes from "./routes/waterRoutes.js";
import moodRoutes from "./routes/moodRoutes.js";
import forumRoutes from "./routes/forumRoutes.js";
import dailyCheckInRoutes from "./routes/dailyCheckIn.js";
import progressReportsRoutes from "./routes/progressReports.js"
import pcosPredictionRoutes from "./routes/pcosPredictionRoutes.js";
import virtualTryOnRoutes from './routes/virtualTryOnRoutes.js';

// ✅ EXISTING WORKOUT FEATURE (PLAN ETC)
import workoutRoutes from "./routes/workoutRoutes.js";

// ✅ ADDED: WORKOUT PROGRESS ROUTES
import workoutProgressRoutes from "./routes/workoutProgressRoutes.js";

// =========================
// SERVICES & MODELS
// =========================
import pcosImpactService from "./services/pcosImpactService.js";
import User from "./models/User.js";
import EnvironmentalData from "./models/EnvironmentalData.js";
import weatherService from "./services/weatherService.js";
import * as environmentalController from "./controllers/environmentalController.js";
import dietRoutes from "./routes/dietRoutes.js";
import skincareRoutes from "./routes/skincareRoutes.js";

import bodyProfileRoutes from "./routes/bodyProfile.js";
import fashionRecommendationRoutes from "./routes/fashionRecommendation.js";
import symptomRoutes from "./routes/symptoms.js";

import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// serve static results produced by the local try-on model
app.use('/outputs', express.static(path.join(__dirname, '../outputs')));


const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://localhost:5178",
  "http://localhost:3000"
];

// Enable CORS for all routes
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle all preflight OPTIONS requests
app.options("*", cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
/* =========================
   PARSERS
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   API ROUTES
========================= */
app.use("/api", routes);
app.use("/api/stats", statsRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/medical-details", medicalDetailsRoutes);

// Cycle tracker
app.use("/api/cycles", cycleRoutes);
app.use("/api/cycles/stats", cycleStatsRoutes);

// Meals / Water / Mood / Forum
app.use("/api/meals", mealRoutes);
app.use("/api/water", waterRoutes);
app.use("/api/mood", moodRoutes);
app.use("/api/forum", forumRoutes);

// Workout plan routes (existing)
app.use("/api/workouts", workoutRoutes);

// ADDED: Workout Progress (logs + stats + streaks)
app.use("/api/workout-progress", workoutProgressRoutes);

app.use("/api/pcos", pcosPredictionRoutes);

app.use("/api/diet", dietRoutes);

app.use("/api/skincare", skincareRoutes);

app.use("/api/daily-checkin", dailyCheckInRoutes);
app.use("/api/progress-reports", progressReportsRoutes);


app.use("/api/body-profile", bodyProfileRoutes);
app.use("/api/fashion", fashionRecommendationRoutes);
app.use("/api/symptoms", symptomRoutes);
app.use("/api/virtual-tryon", virtualTryOnRoutes);
/* =========================
   HEALTH CHECK
========================= */
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "PCOS Sync backend is running",
    timestamp: new Date().toISOString()
  });
});

/* =========================
   ENVIRONMENTAL MONITORING
========================= */
const startEnvironmentalMonitoring = () => {
  cron.schedule(process.env.ALERT_CHECK_INTERVAL || "*/30 * * * *", async () => {
    console.log("🔄 Running environmental monitoring check...");

    try {
      const users = await User.find({
        "preferences.alertsEnabled": true,
        "location.latitude": { $exists: true },
        "location.longitude": { $exists: true }
      });

      console.log(`📊 Monitoring ${users.length} users...`);

      for (const user of users) {
        try {
          const { latitude, longitude } = user.location;

          const [weather, airQuality] = await Promise.all([
            weatherService.getCurrentWeather(latitude, longitude),
            weatherService.getAirQuality(latitude, longitude)
          ]);

          const pcosImpact = pcosImpactService.analyzeImpact(
            weather,
            airQuality,
            user.profile?.symptoms || []
          );

          await environmentalController.checkAndCreateAlerts(
            user,
            weather,
            airQuality,
            pcosImpact
          );

          const environmentalData = new EnvironmentalData({
            userId: user._id,
            location: {
              city: weather.city,
              country: weather.country,
              latitude,
              longitude
            },
            weather,
            airQuality,
            pollution: {
              overallLevel: weatherService.getPollutionLevel(
                airQuality.aqi,
                airQuality.pm25,
                airQuality.pm10
              ),
              sources:
                environmentalController.identifyPollutionSources(airQuality)
            },
            pcosImpact
          });

          await environmentalData.save();
        } catch (userError) {
          console.error(
            `❌ Error monitoring user ${user._id}:`,
            userError.message
          );
        }
      }

      console.log("✅ Environmental monitoring completed");
    } catch (error) {
      console.error("❌ Environmental monitoring error:", error);
    }
  });

  console.log("⏰ Environmental monitoring cron started");
};

/* =========================
   ERROR HANDLER
========================= */
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err : {}
  });
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    startEnvironmentalMonitoring();

    // Try listening with port retry on EADDRINUSE
    const listenOnce = (port) =>
      new Promise((resolve, reject) => {
        const server = app.listen(port);
        server.once('listening', () => resolve(server));
        server.once('error', (err) => reject(err));
      });

    let port = Number(process.env.PORT) || PORT;
    const maxRetries = 5;
    let server;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        server = await listenOnce(port);
        console.log(`🚀 PCOS Sync backend running on http://localhost:${port}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
        console.log("🔑 OpenWeather loaded:", Boolean(process.env.OPENWEATHER_API_KEY));
        break;
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Port ${port} in use, trying port ${port + 1}...`);
          port += 1;
          if (attempt === maxRetries) throw err;
        } else {
          throw err;
        }
      }
    }

    const shutdown = async () => {
      console.log("⚠️  Shutting down server...");
      if (server) {
        server.close(async () => {
          await closeDB();
          process.exit(0);
        });
      } else {
        await closeDB();
        process.exit(0);
      }

      setTimeout(() => {
        console.error("❌ Force shutdown");
        process.exit(1);
      }, 10000).unref();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
