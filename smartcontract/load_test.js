const { RpcProvider, Contract } = require('starknet');
const { performance } = require('perf_hooks');

class CarelLoadTest {
    constructor() {
        this.provider = new RpcProvider({
            nodeUrl: 'http://localhost:5050' // Starknet devnet
        });
        
        this.results = [];
        this.concurrentUsers = 10;
        this.transactionsPerUser = 5;
    }
    
    async runLoadTest() {
        console.log('🚀 Starting CAREL Protocol Load Test');
        console.log(`Concurrent Users: ${this.concurrentUsers}`);
        console.log(`Transactions per User: ${this.transactionsPerUser}`);
        
        const startTime = performance.now();
        
        // Create user promises
        const userPromises = [];
        for (let i = 0; i < this.concurrentUsers; i++) {
            userPromises.push(this.simulateUser(i));
        }
        
        // Wait for all users
        await Promise.all(userPromises);
        
        const endTime = performance.now();
        const totalTime = (endTime - startTime) / 1000;
        
        this.printResults(totalTime);
    }
    
    async simulateUser(userId) {
        const userResults = [];
        
        for (let i = 0; i < this.transactionsPerUser; i++) {
            const start = performance.now();
            
            try {
                // Simulate different operations
                const operation = i % 4;
                
                switch(operation) {
                    case 0:
                        await this.simulateSwap(userId);
                        break;
                    case 1:
                        await this.simulateStake(userId);
                        break;
                    case 2:
                        await this.simulateClaim(userId);
                        break;
                    case 3:
                        await this.simulateNFTMint(userId);
                        break;
                }
                
                const duration = performance.now() - start;
                userResults.push({
                    operation,
                    success: true,
                    duration
                });
                
            } catch (error) {
                const duration = performance.now() - start;
                userResults.push({
                    operation: i % 4,
                    success: false,
                    duration,
                    error: error.message
                });
            }
        }
        
        this.results.push(...userResults);
    }
    
    async simulateSwap(userId) {
        // Simulate swap operation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
        return { hash: `0x${userId.toString(16)}` };
    }
    
    async simulateStake(userId) {
        // Simulate stake operation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 100));
        return { hash: `0x${userId.toString(16)}` };
    }
    
    async simulateClaim(userId) {
        // Simulate claim operation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 150));
        return { hash: `0x${userId.toString(16)}` };
    }
    
    async simulateNFTMint(userId) {
        // Simulate NFT mint operation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 250 + 200));
        return { hash: `0x${userId.toString(16)}` };
    }
    
    printResults(totalTime) {
        console.log('\n📊 LOAD TEST RESULTS');
        console.log('=' * 50);
        
        const totalOps = this.results.length;
        const successfulOps = this.results.filter(r => r.success).length;
        const failedOps = totalOps - successfulOps;
        
        console.log(`Total Time: ${totalTime.toFixed(2)}s`);
        console.log(`Total Operations: ${totalOps}`);
        console.log(`✅ Successful: ${successfulOps}`);
        console.log(`❌ Failed: ${failedOps}`);
        console.log(`Operations per Second: ${(totalOps / totalTime).toFixed(2)}`);
        
        // Calculate average durations by operation
        const ops = ['Swap', 'Stake', 'Claim', 'NFT Mint'];
        ops.forEach((opName, idx) => {
            const opResults = this.results.filter(r => r.operation === idx && r.success);
            if (opResults.length > 0) {
                const avgDuration = opResults.reduce((sum, r) => sum + r.duration, 0) / opResults.length;
                console.log(`${opName} Average: ${avgDuration.toFixed(2)}ms`);
            }
        });
        
        // Calculate percentiles
        const durations = this.results.filter(r => r.success).map(r => r.duration).sort((a, b) => a - b);
        if (durations.length > 0) {
            const p50 = durations[Math.floor(durations.length * 0.5)];
            const p90 = durations[Math.floor(durations.length * 0.9)];
            const p95 = durations[Math.floor(durations.length * 0.95)];
            
            console.log(`\n⏱️ Response Time Percentiles:`);
            console.log(`  50th percentile: ${p50.toFixed(2)}ms`);
            console.log(`  90th percentile: ${p90.toFixed(2)}ms`);
            console.log(`  95th percentile: ${p95.toFixed(2)}ms`);
        }
        
        // Save detailed results
        const fs = require('fs');
        const report = {
            timestamp: new Date().toISOString(),
            config: {
                concurrentUsers: this.concurrentUsers,
                transactionsPerUser: this.transactionsPerUser
            },
            summary: {
                totalTime,
                totalOps,
                successfulOps,
                failedOps,
                opsPerSecond: totalOps / totalTime
            },
            results: this.results
        };
        
        fs.writeFileSync('load_test_report.json', JSON.stringify(report, null, 2));
        console.log('\n📄 Detailed report saved to load_test_report.json');
    }
}

// Run load test if called directly
if (require.main === module) {
    const test = new CarelLoadTest();
    test.runLoadTest().catch(console.error);
}

module.exports = CarelLoadTest;