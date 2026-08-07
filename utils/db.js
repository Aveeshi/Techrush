const {Pool, Client}=require('pg');
require('dotenv').config();

// DATABASE_URL points at Supabase's SESSION-mode pooler (port 5432), which
// caps total concurrent clients at pool_size on Supabase's side (15 by
// default) — a hard ceiling shared across every connection to the
// project, not just this app. Capping our own pool well under that
// (max: 8) leaves headroom for one-off scripts (migrations, this repo's
// scripts/*.js) to connect at the same time without hitting
// EMAXCONNSESSION. idleTimeoutMillis releases connections back quickly
// instead of holding them open indefinitely when idle.
const db= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:{
        rejectUnauthorized:false
    },
    max: 8,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
});

// IMPORTANT: this checked-out client MUST be released back to the pool —
// forgetting release() here used to permanently leak one connection out
// of the pool for the lifetime of the process (every single request
// after startup was working with one fewer available connection than it
// should have, silently making pool exhaustion far more likely).
db.connect((err,client,release)=>{
    if(err){
        console.error('DB connection failed',err.message);
        return;
    }
    console.log('Connected to Supabase PostgresSQL');
    release();
});

module.exports=db;