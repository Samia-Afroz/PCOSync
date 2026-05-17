from flask import Flask, request, jsonify
import joblib
import numpy as np

app = Flask(__name__)

# Load trained model and scaler
model = joblib.load("pcos_model.pkl")
scaler = joblib.load("scaler.pkl")

@app.route("/predict", methods=["POST"])
def predict_pcos():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Use .get() with default 0 to avoid KeyError if some fields are missing
        features = [
            float(data.get("age", 0)),
            float(data.get("weight", 0)),
            float(data.get("height", 0)),
            float(data.get("bmi", 0)),
            float(data.get("cycle", 0)),
            float(data.get("hairLoss", 0)),
            float(data.get("pimples", 0)),
            float(data.get("fastFood", 0)),
            float(data.get("skinDarkening", 0))
        ]

        features = np.array(features).reshape(1, -1)
        scaled_features = scaler.transform(features)
        prediction = model.predict(scaled_features)[0]

        return jsonify({
            "pcos": int(prediction),
            "result": "PCOS Detected" if prediction == 1 else "No PCOS Detected"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(port=8000, debug=True)
