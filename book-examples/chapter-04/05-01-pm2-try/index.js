import express from 'express'
const app = express()
const port = 3000

setTimeout(() => {
    throw new Error('test error')
}, 1000 * 2);


app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})