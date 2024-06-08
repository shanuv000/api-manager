# API Sync - Express-Based API Server

API Sync is a robust and secure Express.js server designed to provide a variety of data, including:

- **Live Cricket Scores:** Up-to-the-minute updates for cricket enthusiasts.
- **T20 World Cup 2024 Information:** Essential details about the tournament.
- **Student Data:** Information related to students.
- **Schedule Information:** Schedules for various events.
- **Ecommerce Data (Flipkart):** Product details from Flipkart for shopping integrations.
- **ESPN Cricinfo Data:** Cricket news, match details, and more from a trusted source.

## Features

- **Security:** Employs Helmet middleware to enhance security by setting appropriate HTTP headers.
- **Rate Limiting:** Protects against abuse by limiting the number of requests per IP address.
- **CORS Handling:** Allows controlled access from specific origins, such as your frontend applications.
- **Error Handling:** Robustly handles errors with a centralized middleware, ensuring a smooth user experience.
- **Structured Routing:** Organizes routes into separate files for better maintainability and scalability.

## Getting Started

### Prerequisites

- Node.js (v12 or higher recommended)
- npm or yarn package manager

### Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/your-username/api-sync.git
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```
   or
   ```bash
   yarn install
   ```

### Running the Server

```bash
npm start
```

or

```bash
yarn start
```

The server will be running at `http://localhost:5000` by default.

## API Endpoints

The server provides several endpoints for accessing different types of data:

- **Cricket:**
  - `/api/cricket/live-scores` - Get live cricket scores.
  - `/api/cricket/schedule` - Get match schedules.
  - `/api/cricket/t20-world-cup-2024` - Get information about the T20 World Cup 2024.
  - `/api/cricket/espn` - Get cricket news and match details from ESPN Cricinfo.
- **Ecommerce:**
  - `/api/buy/flipkart` - Get product details from Flipkart.
- **Students:**
  - `/api/students` - Get information about students.

**Example Usage (Live Scores)**

```bash
GET /api/cricket/live-scores
```

This will return a JSON response containing live cricket scores.

## Middleware

The server uses the following middleware:

- **cors:** Enables Cross-Origin Resource Sharing (CORS) to allow requests from specific origins.
- **express.json():** Parses incoming JSON requests.
- **helmet():** Sets security-related HTTP headers.
- **express-rate-limit:** Limits the number of requests from a single IP address.

## Error Handling

The server includes a custom error handling middleware that catches and logs errors, returning a 500 status code with an error message to the client.

## Deployment

This project is currently deployed on Vercel at [https://api-sync.vercel.app/](https://api-sync.vercel.app/).

## Project Structure

- `index.js`: Main server file responsible for setup and routing.
- `routes/`:
  - `Cricket/`: Contains routes for cricket-related data.
  - `ecommerce/`: Contains routes for Flipkart product data.
  - `students/`: Contains routes for student data.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Let me know if you have any other questions!
