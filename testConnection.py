from flask import Flask

app = Flask(__name__)

@app.route('/')
def home():
    return "<h1>Connection Successful!</h1><p>Your phone can see your computer.</p>"

if __name__ == '__main__':
    # '0.0.0.0' tells the computer to listen to all devices on the Wi-Fi
    # port 5000 is the standard 'door' for Flask
    app.run(host='0.0.0.0', port=5000)