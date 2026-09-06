require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const User = require("./models/User");
const Task = require("./models/Task");
const Withdrawal = require("./models/Withdrawal");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token)
    return res.status(401).json({ message: "Login required" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

/* REGISTER */

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, referral } = req.body;

    const exists = await User.findOne({ email });

    if (exists)
      return res.json({ message: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const referralCode =
      "FM" + Math.random().toString(36).substring(2, 8).toUpperCase();

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      referralCode,
      referredBy: referral || null
    });

    if (referral) {
      const referrer = await User.findOne({
        referralCode: referral
      });

      if (referrer) {
        referrer.balance += 10;
        await referrer.save();
      }
    }

    res.json({
      success: true,
      message: "Account created successfully"
    });

  } catch (error) {
    res.status(500).json({
      message: "Registration error"
    });
  }
});


/* LOGIN */

app.post("/api/login", async (req, res) => {

  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user)
    return res.status(401).json({
      message: "Invalid email or password"
    });

  const match = await bcrypt.compare(
    password,
    user.password
  );

  if (!match)
    return res.status(401).json({
      message: "Invalid email or password"
    });

  const token = jwt.sign(
    {
      id: user._id,
      email: user.email
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );

  res.json({
    success: true,
    token
  });
});


/* USER PROFILE */

app.get("/api/profile", auth, async (req, res) => {

  const user = await User.findById(req.user.id)
    .select("-password");

  res.json(user);
});


/* DAILY BONUS */

app.post("/api/daily-bonus", auth, async (req, res) => {

  const user = await User.findById(req.user.id);

  const now = new Date();

  if (
    user.lastDailyBonus &&
    now - user.lastDailyBonus < 86400000
  ) {
    return res.json({
      message: "Come back tomorrow!"
    });
  }

  const reward = 5;

  user.balance += reward;
  user.lastDailyBonus = now;

  await user.save();

  res.json({
    success: true,
    reward,
    balance: user.balance
  });
});


/* GET TASKS */

app.get("/api/tasks", auth, async (req, res) => {

  const tasks = await Task.find({
    active: true
  });

  res.json(tasks);
});


/* COMPLETE TASK */

app.post("/api/task/:id", auth, async (req, res) => {

  const user = await User.findById(req.user.id);

  const task = await Task.findById(req.params.id);

  if (!task)
    return res.json({
      message: "Task not found"
    });

  if (user.completedTasks.includes(task._id)) {
    return res.json({
      message: "Task already completed"
    });
  }

  user.completedTasks.push(task._id);

  user.balance += task.reward;

  await user.save();

  res.json({
    success: true,
    reward: task.reward,
    balance: user.balance
  });
});


/* WITHDRAW */

app.post("/api/withdraw", auth, async (req, res) => {

  const { amount, method, account } = req.body;

  const user = await User.findById(req.user.id);

  if (amount < 50) {
    return res.json({
      message: "Minimum withdrawal is ₹50"
    });
  }

  if (user.balance < amount) {
    return res.json({
      message: "Insufficient balance"
    });
  }

  user.balance -= amount;

  await user.save();

  await Withdrawal.create({
    userId: user._id,
    amount,
    method,
    account
  });

  res.json({
    success: true,
    message: "Withdrawal request submitted"
  });
});


/* ADMIN - ADD TASK */

app.post("/api/admin/task", async (req, res) => {

  const adminEmail = req.headers["admin-email"];

  if (adminEmail !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({
      message: "Unauthorized"
    });
  }

  const task = await Task.create(req.body);

  res.json(task);
});


/* ADMIN WITHDRAWALS */

app.get("/api/admin/withdrawals", async (req, res) => {

  const adminEmail = req.headers["admin-email"];

  if (adminEmail !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({
      message: "Unauthorized"
    });
  }

  const withdrawals = await Withdrawal.find()
    .populate("userId", "name email")
    .sort({ createdAt: -1 });

  res.json(withdrawals);
});


app.listen(process.env.PORT || 3000, () => {
  console.log("Free Money running...");
});
