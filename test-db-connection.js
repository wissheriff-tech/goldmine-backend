const { MongoClient, ServerApiVersion } = require('mongodb');

// MongoDB Atlas Connection String
const uri = "mongodb+srv://salonmoney2025_db_user:Wisdom1995@salonmoney-cluster.1ehpwp7.mongodb.net/salonmoneynew?retryWrites=true&w=majority&appName=salonmoney-cluster";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function testConnection() {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');

    // Connect the client to the server
    await client.connect();

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });

    console.log("✅ SUCCESS! Pinged your deployment. You successfully connected to MongoDB!");

    // Get database info
    const db = client.db("salonmoneynew");
    const collections = await db.listCollections().toArray();

    console.log('\n📊 Database Information:');
    console.log(`Database Name: salonmoneynew`);
    console.log(`Collections: ${collections.length > 0 ? collections.map(c => c.name).join(', ') : 'No collections yet'}`);

    console.log('\n✅ Connection test completed successfully!');

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('\nFull error:', error);
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
    console.log('\n🔒 Connection closed.');
  }
}

testConnection().catch(console.dir);
