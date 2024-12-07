const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const cron = require("node-cron");
const helmet = require("helmet");
const compression = require("compression");
const mongoose = require("mongoose");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const indexRouter = require("./routes/index.js");
const usersRouter = require("./routes/users.js");
const accountController = require("./controllers/accountController.js");
const coinflip = require("./models/coinflip.js");
const item = require("./models/item.js");

// Environment Variables
dotenv.config();
const port = process.env.PORT || 3000;

// Express App Setup
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(helmet());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// MongoDB Connection
mongoose.set("strictQuery", false);
const mongoDB =
  process.env.MONGODB_URI ||
  "mongodb+srv://saedahmed5191:z4yU8vgJi8AWyGWM@cluster0.lopv7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(mongoDB)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Rate Limiting
const rateLimiter = new RateLimiterMemory({
  points: 125, // Maximum 125 requests
  duration: 300, // Per 5 minutes
});
const socketLimiter = new RateLimiterMemory({
  points: 5,
  duration: 3,
});

// Middleware for Rate Limiting
app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch {
    res.status(429).send("Too many requests");
  }
});

// Socket.io Setup
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
  },
});

// Temporary Message Store
let tempMessageStore = [];

// Socket.io Events
io.on("connection", (socket) => {
  socket.on("bcast", async (data) => {
    try {
      await socketLimiter.consume(socket.handshake.address);
      socket.emit("news", { data });
      socket.broadcast.emit("news", { data });
    } catch (rejRes) {
      socket.emit("blocked", { "retry-ms": rejRes.msBeforeNext });
    }
  });

  if (tempMessageStore.length > 0) {
    socket.emit("LOAD_MESSAGES", tempMessageStore);
  }

  socket.on("SEND_MESSAGE", async (data) => {
    const sender = await accountController.getUserData(data.author);
    if (!sender) return;

    const response = {
      author: {
        username: sender.username,
        role: sender.role,
        avatarId: sender.avatarId,
      },
      message: data.message,
      date: new Date(),
    };

    if (tempMessageStore.length > 40) {
      tempMessageStore.shift();
    }
    tempMessageStore.push(response);
    io.emit("NEW_MESSAGE", response);
  });

  io.emit("USER_COUNT", io.engine.clientsCount);
});

// Cron Jobs
cron.schedule("0 0 * * *", async () => {
  try {
    const response = await fetch(
      "https://api.rolimons.com/items/v1/itemdetails",
    );
    const convertedResponse = await response.json();

    if (!convertedResponse.success) {
      console.error("Item Update Failed");
      return;
    }

    const newArrayItems = Object.entries(convertedResponse.items).map(
      ([id, details]) => ({
        itemId: id,
        itemName: details[0],
        value: details[4],
      }),
    );

    await item.deleteMany({});
    await item.insertMany(newArrayItems);
    console.log("Updated Items");
  } catch (err) {
    console.error("Error updating items:", err);
  }
});

cron.schedule("* * * * *", async () => {
  try {
    await coinflip.deleteMany({
      endedAt: { $lt: Date.now() - 90000 },
    });
    console.log("Deleted Finished Flips");

    const activeCoinflips = await coinflip
      .find({}, { serverSeed: 0 })
      .sort({ value: -1 });

    io.emit("NEW_COINFLIP", activeCoinflips);
  } catch (err) {
    console.error("Error during cron job:", err);
  }
});

// Routes
app.use("/", indexRouter);
app.use("/users", usersRouter);

// Error Handling
app.use((req, res, next) => next(createError(404)));
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  res.status(err.status || 500);
  res.render("error");
});

// Start Server
httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

module.exports = app;
