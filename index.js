require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 9000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))



const sendEmail = (emailAddress, emailData) => {
  // create transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // upgrade later with STARTTLS
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  });

  const mailBody = {
    from: process.env.NODEMAILER_USER,
    to: emailAddress,
    subject: emailData?.subject,
    text: emailData?.message, // plain‑text body
    html: `<p>${emailData?.message}</p>`, // HTML body
  }
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error)
    }
    else {
      console.log(info);
    }
  })
}


// convert to cent
const convertToCent = (amount) => {
  const totalAmount = amount * 100;
  return totalAmount
}



const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// verifyAdmin
const verifyAdmin = async (req, res, next) => {
  const email = req?.user?.email;
  const query = { email }
  const result = await userCollection.findOne(query);
  if (!result || result?.role !== "Admin") {
    return res.status(403).send({ message: "Forbidden access! Only Admin can action" })
  }
  next();
}
// verifySeller
const verifySeller = async (req, res, next) => {
  const email = req?.user?.email;
  const query = { email }
  const result = await userCollection.findOne(query);
  if (!result || result?.role !== "Seller") {
    return res.status(403).send({ message: "Forbidden access! Only Admin can action" })
  }
  next();
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xt5rphe.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

// create db collection
const db = client.db('plantNet-session');
const userCollection = db.collection("users");
const plantsCollection = db.collection("plants")
const ordersCollection = db.collection("orders")

async function run() {
  try {
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })


    // save and update a user in db
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const userInfo = req.body;
      const query = { email }
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await userCollection.insertOne({
        ...userInfo,
        role: 'Customer',
        timestamp: Date.now()
      });
      res.send(result);
    })

    // get user role
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send({ role: result?.role });
    })


    // get all user data
    app.get('/all-users/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await userCollection.find(query).toArray();
      res.send(result)
    })


    // manage user status
    app.patch('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email })
      if (!user || user?.status === "Requested") {
        return res.status(400).send("You have already requested for become a seller. Wait some times 👍")
      }
      const updateDoc = {
        $set: {
          status: "Requested"
        }
      }
      const result = await userCollection.updateOne({ email }, updateDoc);
      res.send(result);
    })

    // update user role
    app.patch('/user/role/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      const filter = { email }
      const updateDoc = {
        $set: {
          role, status: "verified"
        }
      }
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    })



    // save a plant in db
    app.post('/plants', verifyToken, verifySeller, async (req, res) => {
      const plantInfo = req.body;
      const result = await plantsCollection.insertOne(plantInfo);
      res.send(result)
    })


    // delete plant from db by seller
    app.get('/seller/plants', verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      const query = { 'seller.email': email };
      const result = await plantsCollection.find(query).toArray();
      res.send(result);
    })


    // delete plant from db by seller
    app.delete('/delete/plant/seller/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.deleteOne(query);
      res.send(result)
    })


    // get all plants
    app.get('/plants', async (req, res) => {
      const result = await plantsCollection.find().toArray();
      res.send(result);
    })


    // get single plant document
    app.get('/plant/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await plantsCollection.findOne(query);
      res.send(result);
    })

    // save order info in db
    app.post('/order', verifyToken, async (req, res) => {
      const orderInfo = req.body;
      const plant = await plantsCollection.findOne({ _id: new ObjectId(orderInfo?.plantId) })
      if (!plant) {
        res.status(400).send({ message: "Plant Not Found" })
        return
      }
      const totalPrice = orderInfo?.quantity * plant?.price;
      const result = await ordersCollection.insertOne({ ...orderInfo, price: totalPrice });
      if (result?.insertedId) {
        // send email to customer
        sendEmail(orderInfo?.customer?.email, {
          subject: "Order Placed",
          message: `You have placed an order successfully. Order Id is: ${result?.insertedId}`
        })

        // send email to seller
        sendEmail(orderInfo?.sellerEmail, {
          subject: "Order Placed",
          message: `Great news! You got an order from ${orderInfo?.customer?.name}`
        })
      }
      res.send(result);
    })

    // manage order quantity
    app.patch('/plants/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = {
        $inc: { quantity: - quantityToUpdate }
      }

      if (status === 'increase') {
        updateDoc = {
          $inc: { quantity: quantityToUpdate }
        }
      }
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    })


    // get all orders for specific user
    app.get('/orders', verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { "customer.email": email }
      const result = await ordersCollection.aggregate([
        {
          $match: query
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          }
        },
        {
          $lookup: {
            from: "plants",
            localField: "plantId",
            foreignField: "_id",
            as: "plants"
          },
        },
        {
          $unwind: "$plants"
        },
        {
          $addFields: {
            name: "$plants.name",
            category: "$plants.category",
            image: "$plants.image",
          }
        }, {
          $project: {
            plants: 0,
          }
        }
      ]).toArray()
      res.send(result)
    })



    // get all orders for specific seller
    app.get('/orders/seller', verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      const query = { sellerEmail: email }
      const result = await ordersCollection.aggregate([
        {
          $match: query
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          }
        },
        {
          $lookup: {
            from: "plants",
            localField: "plantId",
            foreignField: "_id",
            as: "plants"
          },
        },
        {
          $unwind: "$plants"
        },
        {
          $addFields: {
            name: "$plants.name"
          }
        }, {
          $project: {
            plants: 0,
          }
        }
      ]).toArray()
      res.send(result)
    })


    // update orders status
    app.patch('/order/status/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { status }
      }
      const result = await ordersCollection.updateMany(filter, updateDoc)
      res.send(result)
    })


    // cancel/delete an order
    app.delete('/orders/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query)
      if (order.status === "Delivered") {
        return res.status(409).send("Cannot cancel once the product is Delivered!")
      }
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    })


    // admin stat
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const totalUsers = await userCollection.estimatedDocumentCount();
      const totalPlants = await plantsCollection.estimatedDocumentCount();
      const orderDetails = await ordersCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$price" },
            totalOrders: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0
          }
        }
      ]).next()

      const chartData = await ordersCollection.aggregate([
        {
          $addFields: {
            createDate: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: { $toDate: "$_id" }
              }
            }
          }
        },
        {
          $group: {
            _id: "$createDate",
            orders: { $sum: 1 },
            revenue: { $sum: "$price" },
            totalQuantity: { $sum: "$quantity" }

          }
        },
        {
          $project: {
            _id: 0,
            date: "$_id",
            totalOrders: "$orders",
            totalRevenue: "$revenue",
            totalQuantity: "$totalQuantity"
          }
        },
        { $sort: { date: -1 } }
      ]).toArray()

      res.send({ totalUsers, totalPlants, ...orderDetails, chartData });
    })


    //payment-intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const info = req.body;
      const plant = await plantsCollection.findOne({ _id: new ObjectId(info?.id) })
      if (!plant) {
        return;
      }
      const totalPrice = info?.totalQuantity * plant?.price;
      // create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: convertToCent(totalPrice),
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ clientSecret: paymentIntent?.client_secret })
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
