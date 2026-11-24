"""Layering of the dependency graph."""

from app.dependencies import layer


def test_depth_is_the_longest_chain_of_blockers():
    #   1 -> 2 -> 4,  1 -> 3 -> 4,  2 -> 5,  6 alone
    depth = layer([1, 2, 3, 4, 5, 6], [(1, 2), (1, 3), (2, 4), (3, 4), (2, 5)])
    assert depth == {1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 0}


def test_a_longer_path_wins():
    assert layer([1, 2, 3], [(1, 2), (2, 3), (1, 3)])[3] == 2


def test_empty_graph():
    assert layer([], []) == {}


def test_a_cycle_does_not_loop_forever():
    assert layer([1, 2, 3], [(1, 2), (2, 3), (3, 2)]) == {1: 0, 2: 1, 3: 0}
