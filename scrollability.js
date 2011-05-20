/* See LICENSE for terms of usage */
(function() {

// Number of pixels finger must move to determine horizontal or vertical motion
var kLockThreshold = 10;

// Factor which reduces the length of motion by each move of the finger
var kTouchMultiplier = 1;

// Maximum velocity for motion after user releases finger
var kMaxVelocity = 720 / devicePixelRatio;

// Rate of deceleration after user releases finger
var kDecelRate = 350;

// Percentage of the page which content can be overscrolled before it must bounce back
var kBounceLimit = 0.5;

// Rate of deceleration when content has overscrolled and is slowing down before bouncing back
var kBounceDecelRate = 300;

// Duration of animation when bouncing back
var kBounceTime = 90;

// Percentage of viewport which must be scrolled past in order to snap to the next page
var kPageLimit = 0.05;

// Velocity at which the animation will advance to the next page
var kPageEscapeVelocity = 50;

// Vertical margin of scrollbar
var kScrollbarMargin = 2;

// ===============================================================================================

var startX, startY, touchX, touchY, touchDown, touchMoved;
var animationInterval = 0;
var touchTargets = [];
var lastTouched = null;

var scrollers = {
    'horizontal': createXTarget,
    'vertical': createYTarget
};

function onTouchStart(event) {
    event.preventDefault();
    
    var touched = null;

    var touchCandidate = event.target;
    var holdTimeout = setTimeout(function() {
        holdTimeout = 0;
        touched = setTouched(touchCandidate);
    }, 50);
    
    stopAnimation();
    
    var touch = event.touches[0];
    touchX = startX = touch.clientX;
    touchY = startY = touch.clientY;
    touchDown = true;
    touchMoved = false;
    touchTargets = [];

    var startTime = new Date().getTime();
    var candidates = getTouchTargets(event.target);
    if (candidates.length) {
        for (var i = 0; i < candidates.length; ++i) {
            var target = createTarget(candidates[i], touchX, touchY, startTime);
            if (target) {
                touchTargets.push(target);
            }
        }

        animationInterval = setInterval(touchAnimation, 0);
    }

    lastTouched = touchTargets[0];

    var d = document;
    d.addEventListener('touchmove', onTouchMove, false);
    d.addEventListener('touchend', onTouchEnd, false);

    function onTouchMove(event) {
        event.preventDefault();
        touchMoved = true;
        
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = 0;
        }
        if (touched) {
            releaseTouched(touched);
            touched = null;
        }
        var touch = event.touches[0];
        touchX = touch.clientX;
        touchY = touch.clientY;

        // Reduce the candidates down to the one whose axis follows the finger most closely
        if (touchTargets.length > 1) {
            for (var i = 0; i < touchTargets.length; ++i) {
                var target = touchTargets[i];
                if (target.disable && target.disable(touchX, touchY, startX, startY)) {
                    target.terminator();
                    touchTargets.splice(i, 1);
                    break;
                }
            }
        }
    }

    function onTouchEnd(event) {
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = 0;
        }

        // Simulate a click event when releasing the finger
        if (touched) {
            var evt = document.createEvent('MouseEvents'); 
            evt.initMouseEvent('click', true, true, window, 1);
            touched[0].dispatchEvent(evt); 
            releaseTouched(touched);
        }
        
        d.removeEventListener('touchmove', onTouchMove, false);
        d.removeEventListener('touchend', onTouchEnd, false);
        touchDown = false;
    }
}

function onStatusTapped(event) {
    lastTouched.scrollToTop();
}

function createTarget(target, startX, startY, startTime) {
    var constrained = target.constrained;
    var paginated = target.paginated;
    var viewport = target.viewport || 0;
    var scrollbar = target.scrollbar;
    var position = target.node[target.key];
    var min = target.min;
    var max = target.max;
    var absMin = min;
    var absMax = Math.round(max/viewport)*viewport;
    var velocity = 0;
    var decelerating = 0;
    var decelOrigin, decelDelta;
    var bounceLimit = target.bounce;
    var pageLimit = viewport * kPageLimit;
    var lastTouch = target.filter(startX, startY);
    var lastTime = startTime;
    var stillTime = 0;
    var stillThreshold = 20;
    var snapped = false;
    
    if (paginated) {
        var xposition = Math.round(position/viewport) * viewport;
        min = max = Math.round(xposition + absMax);
    }

    if (scrollbar) {
        target.node.parentNode.appendChild(scrollbar);
    }

    function animator(touch, time) {
        var deltaTime = 1 / (time - lastTime);
        lastTime = time;
        
        var continues = true;
        if (touchDown) {
            var delta = (touch - lastTouch) * kTouchMultiplier;
            if (!delta) {
                // Heuristics to prevent out delta=0 changes from making velocity=0 and
                // stopping all motion in its tracks.  We need to distinguish when the finger
                // has actually stopped moving from when the timer fired too quickly.
                if (!stillTime) {
                    stillTime = time;
                }
                if (time - stillTime < stillThreshold) {
                    return true;
                }
            } else {
                stillTime = 0;
            }
            
            lastTouch = touch;
            velocity = delta / deltaTime;
            
            // Apply resistance along the edges
            if (position > max && constrained) {
                var excess = position - max;
                velocity *= (1.0 - excess / bounceLimit);
            } else if (position < min && constrained) {
                var excess = min - position;
                velocity *= (1.0 - excess / bounceLimit);
            }
        } else {
            if (paginated && !snapped) {
                // When finger is released, decide whether to jump to next/previous page
                // or to snap back to the current page
                snapped = true;
                if (Math.abs(position - max) > pageLimit || Math.abs(velocity) > kPageEscapeVelocity) {
                    if (position > max) {
                        if (max != absMax) {
                            max += viewport;
                            min += viewport;
                        }
                    } else {
                        if (min != absMin) {
                            max -= viewport;
                            min -= viewport;
                        }
                    }
                }
            }

            if (position > max && constrained) {
                if (velocity > 0) {
                    // Slowing down
                    var excess = position - max;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.max(velocity - kBounceDecelRate * deltaTime, 0) * elasticity;
                    decelerating = 0;
                } else {
                    // Bouncing back
                    if (!decelerating) {
                        decelOrigin = position;
                        decelDelta = max - position;
                    }

                    position = easeOutExpo(decelerating, decelOrigin, decelDelta, kBounceTime);
                    return update(position, ++decelerating <= kBounceTime && Math.floor(position) > max);
                }
            } else if (position < min && constrained) {
                if (velocity < 0) {
                    // Slowing down
                    var excess = min - position;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.min(velocity + kBounceDecelRate * deltaTime, 0) * elasticity;
                    decelerating = 0;
                } else {
                    // Bouncing back
                    if (!decelerating) {
                        decelOrigin = position;
                        decelDelta = min - position;
                    }
                    position = easeOutExpo(decelerating, decelOrigin, decelDelta, kBounceTime);
                    return update(position, ++decelerating <= kBounceTime && Math.ceil(position) < min);
                }
            } else {
                // Slowing down
                if (!decelerating) {
                    if (velocity < 0 && velocity < -kMaxVelocity) {
                        velocity = -kMaxVelocity;
                    } else if (velocity > 0 && velocity > kMaxVelocity) {
                        velocity = kMaxVelocity;
                    }
                    decelOrigin = velocity;
                }

                velocity = easeOutExpo(decelerating, decelOrigin, -decelOrigin, kDecelRate);

                if (++decelerating > kDecelRate || Math.floor(velocity) == 0) {
                    continues = false;
                }
            }
        }
        
        position += velocity * deltaTime;
        return update(position, continues);
    }

    function update(pos, continues) {
        position = pos;
        target.node[target.key] = position;
        target.update(target.node, position);

        // Update the scrollbar
        var range = -min - max;
        if (scrollbar && viewport < range) {
            var viewable = viewport - kScrollbarMargin*2;
            var height = (viewable/range) * viewable;
            var scrollPosition = 0;
            if (position > max) {
                height = Math.max(height - (position-max), 5);
                scrollPosition = 0;
            } else if (position < min) {
                height = Math.max(height - (min - position), 5);
                scrollPosition = (viewable-height);
            } else {
                scrollPosition = Math.round((Math.abs(position) / range) * (viewable-height));
            }
            scrollPosition += kScrollbarMargin;
            scrollbar.style.height = Math.round(height) + 'px';

            moveElement(scrollbar, 0, Math.round(scrollPosition));
            
            if (touchMoved) {
                scrollbar.style.opacity = '0.8';
                scrollbar.style.webkitTransition = 'none';
            }
        }

        return continues;
    }
    
    function terminator() {
        // Snap to the integer endpoint, since position may be a subpixel value while animating
        if (paginated) {
            update(Math.round(position/viewport) * viewport);
        } else  if (position > max && constrained) {
            update(max);
        } else if (position < min && constrained) {
            update(min);
        }

        // Hide the scrollbar
        if (scrollbar) {
            scrollbar.style.opacity = '0';
            scrollbar.style.webkitTransition = 'opacity 0.2s linear';
        }
    }

    function scrollToTop() {
       console.log("Trying to hit the top");
       update(0, false); 
    }
    
    return {
        filter: target.filter,
        disable: target.disable,
        animator: animator,
        terminator: terminator,
        scrollToTop: scrollToTop
    };
}

function touchAnimation() {
    var time = new Date().getTime();
    
    // Animate each of the targets
    for (var i = 0; i < touchTargets.length; ++i) {
        var target = touchTargets[i];

        // Translate the x/y touch into the value needed by each of the targets
        var touch = target.filter(touchX, touchY);
        if (!target.animator(touch, time)) {
            target.terminator();
            touchTargets.splice(i--, 1);
        }
    }
    
    if (!touchTargets.length) {
        stopAnimation();
    }
}

// *************************************************************************************************

function getTouchTargets(node) {
    var targets = [];
    while (node) {
        if (node.nodeType == 1) {
            var classes = node.className.split(' ');
            if (classes.indexOf('scrollable') != -1) {
                var paginated = classes.indexOf('paginated') != -1;
                for (var i = 0; i < classes.length; ++i) {
                    var name = classes[i];
                    if (scrollers[name]) {
                        var target = scrollers[name](node);
                        target.key = 'scrollable_'+name;
                        target.paginated = paginated;
                        if (!(target.key in node)) {
                            node[target.key] = target.initial ? target.initial(node) : 0;
                        }

                        targets.push(target);
                    }
                }
                if (classes.indexOf('exclusive') != -1) {
                    break;
                }
            }
        }
        node = node.parentNode;
    }
    return targets;
}

function setTouched(target) {
    var touched = [];
    for (var n = target; n; n = n.parentNode) {
        if (n.nodeType == 1) {
            n.className = (n.className ? n.className + ' ' : '') + 'touched';
            touched.push(n);
        }
    }
    return touched;
}

function releaseTouched(touched) {
    for (var i = 0; i < touched.length; ++i) {
        var n = touched[i];
        n.className = n.className.replace('touched', '');
    }
}

function stopAnimation() {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = 0;

        for (var i = 0; i < touchTargets.length; ++i) {
            var target = touchTargets[i];
            target.terminator();
        }
        touchTargets = [];
    }
}

function moveElement(element, x, y) {
    element.style.webkitTransform = 'translate3d('
        +(x ? (x+'px') : '0')+','
        +(y ? (y+'px') : '0')+','
        +'0)';        
}

function initScrollbar(element) {
    if (!element.scrollableScrollbar) {
        var scrollbar = element.scrollableScrollbar = document.createElement('div');
        scrollbar.className = 'scrollableScrollbar';

        // We hardcode this CSS here to avoid having to provide a CSS file
        scrollbar.style.cssText = [
            'position: absolute',
            'top: 0',
            'right: 2px',
            'width: 5px',
            'min-height: 6px',
            'background: #666',
            'opacity: 0',
            '-webkit-border-radius: 2px 3px',
            '-webkit-transform: translate3d(0,0,0)',
            '-webkit-transition: opacity 0.15s linear'
        ].join(';');
    }
    return element.scrollableScrollbar;
}

function easeOutExpo(t, b, c, d) {
    return (t==d) ? b+c : c * (-Math.pow(2, -10 * t/d) + 1) + b;
}

// *************************************************************************************************

function createXTarget(element) {
    var parent = element.parentNode;
    return {
        node: element,
        min: -parent.scrollWidth + parent.offsetWidth,
        max: 0,
        viewport: parent.offsetWidth,
        bounce: parent.offsetWidth * kBounceLimit,
        constrained: true,
        
        filter: function(x, y) {
            return x; 
        },

        disable: function (x, y, startX, startY) {
            var dx = Math.abs(x - startX);
            var dy = Math.abs(y - startY);
            if (dy > dx && dy > kLockThreshold) {
                return true;
            }
        },

        update: function(element, position) {
            moveElement(element, position, element.scrollable_vertical);
        }
    };
}

function createYTarget(element) {
    var parent = element.parentNode;
    return {
        node: element,
        scrollbar: initScrollbar(element),
        min: -parent.scrollHeight + parent.offsetHeight,
        max: 0,
        viewport: parent.offsetHeight,
        bounce: parent.offsetHeight * kBounceLimit,
        constrained: true,
        
        filter: function(x, y) {
            return y;
        },
        
        disable: function(x, y, startX, startY) {
            var dx = Math.abs(x - startX);
            var dy = Math.abs(y - startY);
            if (dx > dy && dx > kLockThreshold) {
                return true;
            }
        },
        
        update: function(element, position) {
            moveElement(element, element.scrollable_horizontal, position);
        }
    };    
}

document.addEventListener('touchstart', onTouchStart, false);
document.addEventListener('scroll', onStatusTapped, false);

})();
