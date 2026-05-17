// backend/src/models/DietPlan.js
import mongoose from "mongoose";

const DietPlanSchema = new mongoose.Schema(
  {
    user: { type: String, default: "demo-user" },
    mealType: {
      type: String,
      enum: ["Breakfast", "Lunch", "Dinner", "Snack", "Other"],
      default: "Other",
    },
    description: { type: String, default: "" },
    calories: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("DietPlan", DietPlanSchema);
