const proxy_json = require("./http_proxies.json");
const proxies = [
  "http://username:password@proxy1.com:port",
  "http://username:password@proxy2.com:port",
  "http://username:password@proxy3.com:port",
  // Add more proxies as needed
];

module.exports = proxies;
