= The narrator introduces this script.
setvar example/a true

switch example/a
  true -> branch_a
  false -> branch_b
end

branch_a:
= This is a branch.
end

branch_b:
= This message will never get read.
end