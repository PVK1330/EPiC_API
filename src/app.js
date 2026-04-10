const express = require("express");
const app = express();

const authRoutes = require("./routes/auth.routes");
const stripeRoutes = require("./routes/stripe.routes");
const userRoutes = require("./routes/user.routes");
const caseworkerRoutes = require("./routes/caseworker.routes");
const adminRoutes = require("./routes/admin.routes");
const sponsorsRoutes = require("./routes/sponsors.routes");

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/user", userRoutes);
app.use("/api/caseworker", caseworkerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/sponsors", sponsorsRoutes);    

module.exports = app;