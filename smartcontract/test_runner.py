#!/usr/bin/env python3
"""
CAREL Protocol Test Runner
"""

import os
import subprocess
import json
import time
from pathlib import Path
from typing import Dict, List

class CarelTestRunner:
    def __init__(self):
        self.project_root = Path(__file__).parent
        self.test_results = []
        
    def run_unit_tests(self):
        """Run all unit tests"""
        print("🚀 Running unit tests...")
        
        tests = [
            "careltoken",
            "vestingmanager", 
            "treasury",
            "snapshotdistributor",
            "router",
            "nft",
            "staking",
            "points"
        ]
        
        for test in tests:
            self._run_test(f"test_{test}")
            
    def run_integration_tests(self):
        """Run integration tests"""
        print("🔗 Running integration tests...")
        
        tests = [
            "integration_flow",
            "bridge_integration"
        ]
        
        for test in tests:
            self._run_test(f"test_{test}")
            
    def run_security_tests(self):
        """Run security tests"""
        print("🔒 Running security tests...")
        
        tests = [
            "access_control",
            "reentrancy"
        ]
        
        for test in tests:
            self._run_test(f"test_{test}")
    
    def _run_test(self, test_name: str):
        """Run a single test file"""
        test_path = self.project_root / "tests" / "unit" / f"{test_name}.cairo"
        
        if not test_path.exists():
            # Try integration folder
            test_path = self.project_root / "tests" / "integration" / f"{test_name}.cairo"
        
        if not test_path.exists():
            # Try security folder
            test_path = self.project_root / "tests" / "security" / f"{test_name}.cairo"
        
        if test_path.exists():
            print(f"  Testing {test_name}...")
            
            # Compile test
            compile_cmd = [
                "scarb", "cairo-test",
                "--test", test_name,
                f"--test-path={test_path}"
            ]
            
            try:
                result = subprocess.run(
                    compile_cmd,
                    capture_output=True,
                    text=True,
                    cwd=self.project_root
                )
                
                if result.returncode == 0:
                    print(f"    ✅ {test_name} passed")
                    self.test_results.append({
                        "test": test_name,
                        "status": "PASS",
                        "output": result.stdout
                    })
                else:
                    print(f"    ❌ {test_name} failed")
                    print(f"    Error: {result.stderr}")
                    self.test_results.append({
                        "test": test_name,
                        "status": "FAIL",
                        "output": result.stderr
                    })
                    
            except Exception as e:
                print(f"    ⚠️ Error running {test_name}: {e}")
                self.test_results.append({
                    "test": test_name,
                    "status": "ERROR",
                    "output": str(e)
                })
        else:
            print(f"    ⚠️ Test file not found: {test_name}")
    
    def run_load_tests(self):
        """Run load/performance tests"""
        print("📊 Running load tests...")
        
        # Deploy contracts to devnet
        self._deploy_to_devnet()
        
        # Run JavaScript load tests
        load_test_path = self.project_root / "load_test.js"
        if load_test_path.exists():
            subprocess.run(["node", str(load_test_path)])
    
    def _deploy_to_devnet(self):
        """Deploy contracts to Starknet devnet for testing"""
        print("  Deploying to devnet...")
        
        deploy_script = self.project_root / "scripts" / "deploy_testnet.py"
        if deploy_script.exists():
            subprocess.run(["python", str(deploy_script)])
    
    def generate_coverage_report(self):
        """Generate test coverage report"""
        print("📈 Generating coverage report...")
        
        coverage_script = self.project_root / "coverage_report.sh"
        if coverage_script.exists():
            subprocess.run(["bash", str(coverage_script)])
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*50)
        print("📋 TEST SUMMARY")
        print("="*50)
        
        passed = sum(1 for r in self.test_results if r["status"] == "PASS")
        failed = sum(1 for r in self.test_results if r["status"] == "FAIL")
        errors = sum(1 for r in self.test_results if r["status"] == "ERROR")
        
        print(f"Total Tests: {len(self.test_results)}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"⚠️ Errors: {errors}")
        
        if failed > 0:
            print("\nFailed Tests:")
            for result in self.test_results:
                if result["status"] == "FAIL":
                    print(f"  - {result['test']}")
        
        # Save results to file
        report = {
            "timestamp": time.time(),
            "summary": {
                "total": len(self.test_results),
                "passed": passed,
                "failed": failed,
                "errors": errors
            },
            "results": self.test_results
        }
        
        report_path = self.project_root / "test_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        
        print(f"\n📄 Full report saved to: {report_path}")

def main():
    """Main test runner"""
    runner = CarelTestRunner()
    
    # Run tests
    runner.run_unit_tests()
    runner.run_integration_tests()
    runner.run_security_tests()
    
    # Optional: Run load tests (requires devnet)
    # runner.run_load_tests()
    
    # Generate coverage report
    runner.generate_coverage_report()
    
    # Print summary
    runner.print_summary()
    
    # Exit with error code if tests failed
    failed = sum(1 for r in runner.test_results if r["status"] == "FAIL")
    if failed > 0:
        exit(1)

if __name__ == "__main__":
    main()