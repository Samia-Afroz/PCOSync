import axios from "axios";

export const predictPCOS = async (req, res) => {
  try {
    const requiredFields = [
      "age", "weight", "height", "bmi", "cycle", 
      "hairLoss", "pimples", "fastFood", "skinDarkening"
    ];

    const missingFields = requiredFields.filter(field => req.body[field] === undefined);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: "Missing required fields",
        missingFields
      });
    }

    const response = await axios.post(
      "http://localhost:8000/predict",
      req.body
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error("PCOS Prediction Backend Error:", error.message);
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.error || error.message;

    res.status(statusCode).json({
      message: "PCOS prediction failed",
      error: errorMessage
    });
  }
};
