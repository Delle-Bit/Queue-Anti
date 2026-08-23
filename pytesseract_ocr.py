import sys, json, base64, os, tempfile
from pathlib import Path
import pytesseract
from PIL import Image

# Explicitly point to the Tesseract executable (adjust if installed elsewhere)
# Common installation path on Windows: C:\\Program Files\\Tesseract-OCR\\tesseract.exe
pytesseract.pytesseract.tesseract_cmd = r"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"

def get_image_from_input(image_input):
    # If input is a file path, load directly
    if os.path.isfile(image_input):
        return Image.open(image_input)
    # Otherwise assume base64 string
    try:
        img_data = base64.b64decode(image_input)
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
            tmp.write(img_data)
            tmp_path = tmp.name
        return Image.open(tmp_path)
    except Exception as e:
        raise ValueError(f"Unable to decode image data: {e}")

def main():
    input_data = sys.stdin.read()
    try:
        payload = json.loads(input_data)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input"}))
        sys.exit(1)
    image = payload.get("image")
    if not image:
        print(json.dumps({"error": "No image provided"}))
        sys.exit(1)
    try:
        img = get_image_from_input(image)
        text = pytesseract.image_to_string(img)
        print(json.dumps({"text": text.strip()}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
