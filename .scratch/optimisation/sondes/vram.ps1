# Total Committed du process GPU WebView2 de NOTRE fenetre.
#
# Instrument impose par la memoire projet : nvidia-smi compte le GPU ENTIER et
# derive avec la charge de la machine ; Dedicated Usage ne compte que le
# resident et a rendu 1203 puis 2348 Mo pour le MEME document. Total Committed
# compte le resident ET le pagine, et isole l'application.
#
# La machine porte DEUX instances WebView2 : on prend la plus recemment demarree,
# qui est la fenetre pilotee par CDP dans cette session.

$gpu = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
  Where-Object { $_.CommandLine -match '--type=gpu-process' } |
  ForEach-Object { [pscustomobject]@{ Pid = $_.ProcessId; Start = (Get-Process -Id $_.ProcessId).StartTime } } |
  Sort-Object Start -Descending

if (-not $gpu) { Write-Output "aucun process gpu WebView2"; exit 1 }

foreach ($p in $gpu) {
  $chemin = "\GPU Process Memory(pid_$($p.Pid)*)\Total Committed"
  try {
    $ech = Get-Counter -Counter $chemin -ErrorAction Stop
    $total = ($ech.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
    $mo = [math]::Round($total / 1MB, 1)
    Write-Output "pid=$($p.Pid) demarre=$($p.Start.ToString('HH:mm:ss')) TotalCommitted=$mo Mo (instances=$($ech.CounterSamples.Count))"
  } catch {
    Write-Output "pid=$($p.Pid) compteur absent"
  }
}
