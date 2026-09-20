const mongoose = require("mongoose");
require("dotenv").config();

exports.connect = async () => {
    try {
        const dbURL = process.env.DATABASE_URL;

        if (!dbURL) {
            throw new Error("Check your .env file!");
        }

        await mongoose.connect(dbURL);
        console.log("✅ Database Connected Successfully!");
    } catch (error) {
        console.error("❌ Error in database connection!", error);
        process.exit(1);
    }
};
