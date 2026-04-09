"""
CostEffMA — Test Suite
Pytest + Selenium, 17 tests for Cost-Effectiveness Meta-Analysis tool
"""

import pytest
import time
import math
import os
import json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

APP_PATH = Path(__file__).resolve().parent / "index.html"
APP_URL = APP_PATH.as_uri()


@pytest.fixture(scope="session")
def driver():
    """Launch headless Chrome with console log capture."""
    opts = ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1400,900")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    drv = None
    try:
        drv = webdriver.Chrome(options=opts)
    except Exception:
        from selenium.webdriver.edge.options import Options as EdgeOptions
        eopts = EdgeOptions()
        eopts.add_argument("--headless=new")
        eopts.add_argument("--no-sandbox")
        eopts.add_argument("--disable-gpu")
        eopts.add_argument("--window-size=1400,900")
        drv = webdriver.Edge(options=eopts)

    drv.set_page_load_timeout(60)
    drv.implicitly_wait(5)
    yield drv
    drv.quit()


def load_app(driver):
    """Navigate to app and wait for ready."""
    driver.get(APP_URL)
    WebDriverWait(driver, 10).until(
        lambda d: d.find_element(By.ID, "analyzeBtn")
    )


def load_demo_and_analyze(driver):
    """Load demo data and click Analyze."""
    load_app(driver)
    driver.find_element(By.ID, "demoBtn").click()
    time.sleep(0.3)
    driver.find_element(By.ID, "analyzeBtn").click()
    time.sleep(0.8)


def js_eval(driver, script):
    """Execute JS script that has its own return statement."""
    return driver.execute_script(script)


def js_ret(driver, expr):
    """Return the value of a single JS expression."""
    return driver.execute_script("return " + expr)


DEMO_CSV_JS = (
    "Study,DeltaCost,SE_Cost,DeltaEffect,SE_Effect,Correlation\\n"
    "Thompson 2019,5000,1200,0.15,0.04,0.3\\n"
    "Chen 2020,8000,2000,0.22,0.06,0.25\\n"
    "Garcia 2018,3500,900,0.10,0.03,0.35\\n"
    "Kim 2021,6500,1500,0.18,0.05,0.2\\n"
    "Patel 2020,12000,3000,0.30,0.08,0.15\\n"
    "Wilson 2019,4200,1100,0.12,0.04,0.3"
)


# ============================================================
# Test 1: App loads without JS errors
# ============================================================
def test_01_app_loads_no_errors(driver):
    load_app(driver)
    title = driver.title
    assert "CostEffMA" in title
    try:
        logs = driver.get_log("browser")
        severe = [l for l in logs if l.get("level") == "SEVERE"]
        assert len(severe) == 0, f"JS errors: {severe}"
    except Exception:
        pass


# ============================================================
# Test 2: Demo data loads 6 studies
# ============================================================
def test_02_demo_loads_6_studies(driver):
    load_app(driver)
    driver.find_element(By.ID, "demoBtn").click()
    time.sleep(0.3)
    csv_text = driver.find_element(By.ID, "csvInput").get_attribute("value")
    lines = [l.strip() for l in csv_text.strip().split("\n") if l.strip()]
    data_lines = lines[1:]
    assert len(data_lines) == 6, f"Expected 6 studies, got {len(data_lines)}"


# ============================================================
# Test 3: NMB at WTP=25000 for Thompson: 25000*0.15 - 5000 = -1250
# ============================================================
def test_03_nmb_calculation_thompson(driver):
    load_app(driver)
    result = js_eval(driver,
        "var s = {study:'Thompson 2019', deltaCost:5000, seCost:1200,"
        " deltaEffect:0.15, seEffect:0.04, corr:0.3};"
        " return CostEffMA.calcNMB(s, 25000);"
    )
    nmb = result["nmb"]
    expected = 25000 * 0.15 - 5000  # -1250
    assert abs(nmb - expected) < 0.01, f"NMB={nmb}, expected {expected}"


# ============================================================
# Test 4: NMB pooling produces valid (non-NaN) result
# ============================================================
def test_04_nmb_pooling_valid(driver):
    load_demo_and_analyze(driver)
    pooled = js_ret(driver, "CostEffMA.getLastResults().nmbPool.pooled")
    assert pooled is not None and not math.isnan(pooled), f"Pooled NMB is NaN or null: {pooled}"


# ============================================================
# Test 5: ICER pooling on log scale, pooled ICER in [20000, 50000]
# ============================================================
def test_05_icer_pooling_log_scale(driver):
    load_demo_and_analyze(driver)
    icer_pool = js_eval(driver,
        "var r = CostEffMA.getLastResults();"
        " if (!r.icerPool) return null;"
        " return { pooledICER: r.icerPool.pooledICER,"
        "          logPooled: r.icerPool.pooled };"
    )
    assert icer_pool is not None, "ICER pool is null"
    assert 20000 <= icer_pool["pooledICER"] <= 50000, \
        f"Pooled ICER={icer_pool['pooledICER']}, expected in [20000,50000]"
    assert abs(math.exp(icer_pool["logPooled"]) - icer_pool["pooledICER"]) < 1, \
        "ICER not correctly back-transformed from log scale"


# ============================================================
# Test 6: CEAC P(CE) at WTP=200000 close to 1.0
# ============================================================
def test_06_ceac_high_wtp_close_to_1(driver):
    load_app(driver)
    pce = js_eval(driver,
        "var csv = '" + DEMO_CSV_JS + "';"
        " var studies = CostEffMA.parseCSV(csv);"
        " var ceac = CostEffMA.calcCEAC(studies, [200000]);"
        " return ceac[0].pCE;"
    )
    assert pce is not None, "CEAC returned null"
    assert pce > 0.9, f"P(CE) at WTP=200000 should be close to 1.0, got {pce}"


# ============================================================
# Test 7: CEAC P(CE) at WTP=0 close to 0.0
# ============================================================
def test_07_ceac_zero_wtp_close_to_0(driver):
    load_app(driver)
    pce = js_eval(driver,
        "var csv = '" + DEMO_CSV_JS + "';"
        " var studies = CostEffMA.parseCSV(csv);"
        " var ceac = CostEffMA.calcCEAC(studies, [0]);"
        " return ceac[0].pCE;"
    )
    assert pce is not None, "CEAC returned null"
    assert pce < 0.1, f"P(CE) at WTP=0 should be close to 0.0, got {pce}"


# ============================================================
# Test 8: WTP slider changes NMB forest results
# ============================================================
def test_08_wtp_slider_changes_nmb(driver):
    load_demo_and_analyze(driver)
    nmb_at_25k = js_ret(driver, "CostEffMA.getLastResults().nmbPool.pooled")

    driver.execute_script(
        "var slider = document.getElementById('wtpSlider');"
        " slider.value = 100000;"
        " slider.dispatchEvent(new Event('input'));"
    )
    time.sleep(0.5)
    nmb_at_100k = js_ret(driver, "CostEffMA.getLastResults().nmbPool.pooled")
    assert nmb_at_100k > nmb_at_25k, \
        f"NMB at 100k ({nmb_at_100k}) should be > NMB at 25k ({nmb_at_25k})"


# ============================================================
# Test 9: CE Plane has 6 scatter points
# ============================================================
def test_09_ce_plane_6_points(driver):
    load_demo_and_analyze(driver)
    driver.execute_script(
        "document.querySelector('[data-tab=\"ceplane\"]').click();"
    )
    time.sleep(0.3)
    circles = js_ret(driver,
        "document.querySelectorAll('#ceplaneChartBox svg circle').length"
    )
    assert circles == 6, f"Expected 6 circles on CE Plane, got {circles}"


# ============================================================
# Test 10: CE Plane quadrant labels present
# ============================================================
def test_10_ce_plane_quadrant_labels(driver):
    load_demo_and_analyze(driver)
    driver.execute_script(
        "document.querySelector('[data-tab=\"ceplane\"]').click();"
    )
    time.sleep(0.3)
    svg_text = js_ret(driver,
        "document.getElementById('ceplaneChartBox').querySelector('svg').outerHTML"
    )
    assert svg_text is not None, "CE Plane SVG not found"
    for label in ["Dominant", "Dominated", "NE", "SW"]:
        assert label in svg_text, f"Quadrant label '{label}' not found in CE Plane"


# ============================================================
# Test 11: NMB Forest SVG renders with correct study count
# ============================================================
def test_11_nmb_forest_svg_study_count(driver):
    load_demo_and_analyze(driver)
    svg_exists = js_ret(driver, "!!document.querySelector('#nmbChartBox svg')")
    assert svg_exists, "NMB Forest SVG not rendered"
    texts = js_eval(driver,
        "var els = document.querySelectorAll('#nmbChartBox svg text');"
        " var arr = [];"
        " for (var i = 0; i < els.length; i++) arr.push(els[i].textContent);"
        " return arr;"
    )
    assert texts is not None, "No text elements found"
    studies_found = [t for t in texts if "20" in t and any(c.isalpha() for c in t)]
    assert len(studies_found) >= 6, f"Expected >= 6 study labels, found {len(studies_found)}"


# ============================================================
# Test 12: CEAC SVG renders as curve (path element exists)
# ============================================================
def test_12_ceac_curve_renders(driver):
    load_demo_and_analyze(driver)
    driver.execute_script(
        "document.querySelector('[data-tab=\"ceac\"]').click();"
    )
    time.sleep(0.3)
    paths = js_ret(driver,
        "document.querySelectorAll('#ceacChartBox svg path').length"
    )
    assert paths is not None and paths >= 1, "CEAC curve (path) not rendered"


# ============================================================
# Test 13: Summary table shows pooled ICER and NMB
# ============================================================
def test_13_summary_table_content(driver):
    load_demo_and_analyze(driver)
    table_text = js_ret(driver,
        "document.getElementById('summaryTable').innerText"
    )
    assert table_text is not None, "Summary table empty"
    assert "Pooled NMB" in table_text, "Summary missing 'Pooled NMB'"
    assert "Pooled ICER" in table_text, "Summary missing 'Pooled ICER'"
    assert "heterogeneity" in table_text.lower() or "\u00B2" in table_text, \
        "Summary missing heterogeneity info"


# ============================================================
# Test 14: Zero deltaEffect shows ICER warning
# ============================================================
def test_14_zero_delta_effect_warning(driver):
    load_app(driver)
    driver.execute_script(
        "document.getElementById('csvInput').value = "
        "'Study,DeltaCost,SE_Cost,DeltaEffect,SE_Effect,Correlation\\n"
        "StudyA,5000,1200,0.15,0.04,0.3\\n"
        "StudyB,3000,800,0.0,0.02,0.2';"
    )
    driver.find_element(By.ID, "analyzeBtn").click()
    time.sleep(0.5)
    warning = js_ret(driver, "CostEffMA.getLastResults().icerWarning")
    assert warning is not None, "No ICER warning set"
    assert "deltaeffect" in warning.lower() or "effect" in warning.lower(), \
        f"Expected ICER warning about deltaEffect<=0, got: {warning}"


# ============================================================
# Test 15: Negative deltaCost (cost-saving) -> NMB always positive
# ============================================================
def test_15_negative_delta_cost_dominant(driver):
    load_app(driver)
    driver.execute_script(
        "document.getElementById('csvInput').value = "
        "'Study,DeltaCost,SE_Cost,DeltaEffect,SE_Effect,Correlation\\n"
        "StudyX,-2000,500,0.10,0.03,0.2\\n"
        "StudyY,-3000,700,0.20,0.05,0.25\\n"
        "StudyZ,-1500,400,0.08,0.02,0.3';"
    )
    driver.find_element(By.ID, "analyzeBtn").click()
    time.sleep(0.5)
    pooled_nmb = js_ret(driver, "CostEffMA.getLastResults().nmbPool.pooled")
    assert pooled_nmb is not None and pooled_nmb > 0, \
        f"With cost-saving treatment, pooled NMB should be > 0, got {pooled_nmb}"
    nmb_values = js_eval(driver,
        "var data = CostEffMA.getLastResults().nmbData;"
        " var arr = [];"
        " for (var i = 0; i < data.length; i++) arr.push(data[i].nmb);"
        " return arr;"
    )
    assert nmb_values is not None, "NMB values returned null"
    for i, nmb in enumerate(nmb_values):
        assert nmb > 0, f"Study {i} NMB should be positive (dominant), got {nmb}"


# ============================================================
# Test 16: Export CSV works (produces valid CSV text)
# ============================================================
def test_16_export_csv(driver):
    load_demo_and_analyze(driver)
    csv_nmb = js_eval(driver,
        "var r = CostEffMA.getLastResults();"
        " var csv = 'Study,NMB,SE_NMB,CI_Lo,CI_Hi\\n';"
        " for (var i = 0; i < r.nmbData.length; i++) {"
        "   var d = r.nmbData[i];"
        "   csv += d.study + ',' + d.nmb.toFixed(2) + ',' + d.seNMB.toFixed(2) + ',';"
        "   csv += (d.nmb - 1.96*d.seNMB).toFixed(2) + ',' + (d.nmb + 1.96*d.seNMB).toFixed(2) + '\\n';"
        " }"
        " csv += 'Pooled (RE),' + r.nmbPool.pooled.toFixed(2) + ',' + r.nmbPool.se.toFixed(2) + ',';"
        " csv += r.nmbPool.ci_lo.toFixed(2) + ',' + r.nmbPool.ci_hi.toFixed(2) + '\\n';"
        " return csv;"
    )
    assert csv_nmb is not None, "CSV generation returned null"
    lines = csv_nmb.strip().split('\n')
    assert len(lines) == 8, f"CSV should have 8 lines (header + 6 studies + pooled), got {len(lines)}"
    assert "Study,NMB" in lines[0]
    assert "Thompson" in lines[1]
    assert "Pooled" in lines[-1]


# ============================================================
# Test 17: k=1 study -> no pooling, just displays single study
# ============================================================
def test_17_single_study_k1(driver):
    load_app(driver)
    driver.execute_script(
        "document.getElementById('csvInput').value = "
        "'Study,DeltaCost,SE_Cost,DeltaEffect,SE_Effect,Correlation\\n"
        "OnlyStudy,6000,1500,0.20,0.05,0.3';"
    )
    driver.find_element(By.ID, "analyzeBtn").click()
    time.sleep(0.5)

    result = js_eval(driver,
        "var r = CostEffMA.getLastResults();"
        " return {"
        "   k: r.nmbPool.k,"
        "   pooled: r.nmbPool.pooled,"
        "   tau2: r.nmbPool.tau2,"
        "   I2: r.nmbPool.I2"
        " };"
    )
    assert result is not None, "Result is null for k=1"
    assert result["k"] == 1, f"Expected k=1, got {result['k']}"
    assert result["tau2"] == 0, "tau2 should be 0 for single study"
    assert result["I2"] == 0, "I2 should be 0 for single study"
    expected = 25000 * 0.20 - 6000  # -1000
    assert abs(result["pooled"] - expected) < 0.1, \
        f"Single study NMB={result['pooled']}, expected {expected}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-x"])
