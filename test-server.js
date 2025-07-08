const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(`
    <html>
      <head><title>AI Platform Test</title></head>
      <body>
        <h1>🚀 AI Platform Test Server</h1>
        <p>✅ Node.js is working!</p>
        <p><strong>Server Info:</strong></p>
        <ul>
          <li>Node Version: ${process.version}</li>
          <li>Platform: ${process.platform}</li>
          <li>Architecture: ${process.arch}</li>
          <li>Time: ${new Date().toISOString()}</li>
        </ul>
        <p><strong>Environment:</strong></p>
        <ul>
          <li>NODE_ENV: ${process.env.NODE_ENV || 'not set'}</li>
          <li>PORT: ${process.env.PORT || '3000'}</li>
        </ul>
        <hr>
        <p>🎯 Next Step: Implement authentication service</p>
      </body>
    </html>
  `);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log(`📍 Visit: https://ai.xingyuncl.com`);
});
