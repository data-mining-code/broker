const serverRouter = require('server-router')
const http = require('http')

const router = serverRouter()

router.route('GET', '/api/request', (req, res, ctx) => {
  res.end(JSON.stringify({
    text: 'Test API return'
  }))
})

http.createServer(router.start()).listen(3030)
