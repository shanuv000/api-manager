# API Sync

API Sync is an Express-based API server that provides live scores, T20 World Cup 2024 information, student data, and schedules. The server supports CORS and includes logging middleware for route hits.

## Features

- Live Scores
- T20 World Cup 2024 Information
- Student Data
- Schedule Information

## Getting Started

### Prerequisites

- Node.js
- npm or yarn

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/api-sync.git
   ```

2. Navigate to the project directory:

   ```bash
   cd api-sync
   ```

3. Install the dependencies:

   ```bash
   npm install
   ```

   or

   ```bash
   yarn install
   ```

### Running the Server

1. Start the server:

   ```bash
   npm start
   ```

   or

   ```bash
   yarn start
   ```

2. The server will run on the specified port (default is 5000). You should see the following message in your terminal:

   ```bash
   Server running on port 5000
   ```

## API Endpoints

- **Live Scores**: `/api/live-scores`
- **Schedule**: `/api/schedule`
- **T20 World Cup 2024**: `/api/t20-world-cup-2024`
- **Students**: `/api/students`

### Example Routes

- **Live Scores**

  ```bash
  GET /api/live-scores
  ```

- **Schedule**

  ```bash
  GET /api/schedule
  ```

- **T20 World Cup 2024**

  ```bash
  GET /api/t20-world-cup-2024
  ```

- **Students**

  ```bash
  GET /api/students
  ```

## Middleware

### Logging Middleware

Each route includes logging middleware that logs a message to the console whenever the route is hit.

### Error Handling Middleware

If any error occurs during request handling, the error handling middleware will catch it and respond with a 500 status code and an error message.

## Deployment

The project is deployed at [https://api-sync.vercel.app/](https://api-sync.vercel.app/).

## Contributing

If you would like to contribute, please create a fork of the repository and submit a pull request with your changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

- Express
- Vercel
