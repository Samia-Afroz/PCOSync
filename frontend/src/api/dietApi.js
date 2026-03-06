import { API_URL } from "../utils/constants";

const API_BASE = `${API_URL}/diet`;

const getToken = () => localStorage.getItem("token");

export const getDietPlan = async () => {
  try {
    const res = await fetch(`${API_BASE}/plan`, {
      headers: {
        Authorization: `Bearer ${getToken()}`
      }
    });

    const data = await res.json();
    return { status: res.status, result: data };
  } catch {
    return {
      status: 500,
      result: { message: "Failed to fetch diet plan" }
    };
  }
};
